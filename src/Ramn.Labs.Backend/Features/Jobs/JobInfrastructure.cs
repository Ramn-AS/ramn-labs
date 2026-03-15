using System.Collections.Concurrent;
using System.Threading.Channels;
using System.IO.Compression;
using System.Text;

namespace Ramn.Labs.Backend.Features.Jobs;

/// <summary>
/// Represents the common lifecycle states for background jobs.
/// </summary>
public enum BackgroundJobStatus
{
    Queued,
    Running,
    Completed,
    Failed,
    TimedOut,
    Dropped
}

/// <summary>
/// Represents structured error details for background job APIs.
/// </summary>
public sealed class BackgroundJobErrorDetails
{
    /// <summary>
    /// Gets or sets stable error code.
    /// </summary>
    public required string ErrorCode { get; set; }

    /// <summary>
    /// Gets or sets user-facing message.
    /// </summary>
    public required string Message { get; set; }

    /// <summary>
    /// Gets or sets additional context details.
    /// </summary>
    public Dictionary<string, string> Details { get; set; } = new(StringComparer.Ordinal);
}

/// <summary>
/// Defines common mutable state required by queued background jobs.
/// </summary>
/// <typeparam name="TId">The job identifier type.</typeparam>
public interface IBackgroundJobRecord<TId>
{
    /// <summary>
    /// Gets the job id.
    /// </summary>
    TId JobId { get; }

    /// <summary>
    /// Gets or sets current job status.
    /// </summary>
    BackgroundJobStatus Status { get; set; }

    /// <summary>
    /// Gets or sets creation timestamp in UTC.
    /// </summary>
    DateTimeOffset CreatedAtUtc { get; set; }

    /// <summary>
    /// Gets or sets queue entry timestamp in UTC.
    /// </summary>
    DateTimeOffset QueuedAtUtc { get; set; }

    /// <summary>
    /// Gets or sets running start timestamp in UTC.
    /// </summary>
    DateTimeOffset? StartedAtUtc { get; set; }

    /// <summary>
    /// Gets or sets completion timestamp in UTC.
    /// </summary>
    DateTimeOffset? CompletedAtUtc { get; set; }

    /// <summary>
    /// Gets or sets most recent poll timestamp in UTC.
    /// </summary>
    DateTimeOffset LastPolledAtUtc { get; set; }

    /// <summary>
    /// Gets or sets queue sequence number for wait estimation.
    /// </summary>
    long QueueSequence { get; set; }

    /// <summary>
    /// Gets or sets optional processing error details.
    /// </summary>
    BackgroundJobErrorDetails? Error { get; set; }
}

/// <summary>
/// Abstraction for transporting background job ids through a bounded queue.
/// </summary>
/// <typeparam name="TId">The job identifier type.</typeparam>
public interface IBackgroundJobQueue<TId>
{
    /// <summary>
    /// Enqueues a job id if queue capacity allows.
    /// </summary>
    bool TryEnqueue(TId jobId);

    /// <summary>
    /// Gets the queue reader consumed by worker services.
    /// </summary>
    ChannelReader<TId> Reader { get; }
}

/// <summary>
/// Channel-based bounded queue for background job processing.
/// </summary>
/// <typeparam name="TId">The job identifier type.</typeparam>
public sealed class ChannelBackgroundJobQueue<TId> : IBackgroundJobQueue<TId>
{
    private readonly Channel<TId> _channel;

    /// <summary>
    /// Initializes a queue using the provided capacity.
    /// </summary>
    /// <param name="capacity">The maximum queue size.</param>
    public ChannelBackgroundJobQueue(int capacity)
    {
        _channel = Channel.CreateBounded<TId>(new BoundedChannelOptions(Math.Max(1, capacity))
        {
            FullMode = BoundedChannelFullMode.DropWrite,
            SingleReader = true,
            SingleWriter = false
        });
    }

    /// <inheritdoc />
    public bool TryEnqueue(TId jobId) => _channel.Writer.TryWrite(jobId);

    /// <inheritdoc />
    public ChannelReader<TId> Reader => _channel.Reader;
}

/// <summary>
/// Abstraction for background job state persistence.
/// </summary>
/// <typeparam name="TId">The job identifier type.</typeparam>
/// <typeparam name="TJob">The job record type.</typeparam>
public interface IBackgroundJobStore<TId, TJob>
    where TJob : class, IBackgroundJobRecord<TId>
{
    /// <summary>
    /// Adds a new job record.
    /// </summary>
    void Add(TJob job);

    /// <summary>
    /// Gets a job by id if it exists.
    /// </summary>
    bool TryGet(TId jobId, out TJob? job);

    /// <summary>
    /// Gets all current job records.
    /// </summary>
    IReadOnlyCollection<TJob> GetAll();

    /// <summary>
    /// Removes a job from store.
    /// </summary>
    bool TryRemove(TId jobId, out TJob? removed);
}

/// <summary>
/// Thread-safe in-memory storage for active and recent background jobs.
/// </summary>
/// <typeparam name="TId">The job identifier type.</typeparam>
/// <typeparam name="TJob">The job record type.</typeparam>
public sealed class InMemoryBackgroundJobStore<TId, TJob> : IBackgroundJobStore<TId, TJob>
    where TId : notnull
    where TJob : class, IBackgroundJobRecord<TId>
{
    private readonly ConcurrentDictionary<TId, TJob> _jobs = new();

    /// <inheritdoc />
    public void Add(TJob job) => _jobs[job.JobId] = job;

    /// <inheritdoc />
    public bool TryGet(TId jobId, out TJob? job)
    {
        var found = _jobs.TryGetValue(jobId, out var tmp);
        job = tmp;
        return found;
    }

    /// <inheritdoc />
    public IReadOnlyCollection<TJob> GetAll() => _jobs.Values.ToArray();

    /// <inheritdoc />
    public bool TryRemove(TId jobId, out TJob? removed)
    {
        var found = _jobs.TryRemove(jobId, out var tmp);
        removed = tmp;
        return found;
    }
}

/// <summary>
/// Computes queue wait-time estimates from queued/running state and execution parallelism.
/// </summary>
/// <typeparam name="TId">The job identifier type.</typeparam>
/// <typeparam name="TJob">The job record type.</typeparam>
public sealed class BackgroundJobWaitEstimator<TId, TJob>
    where TId : notnull
    where TJob : class, IBackgroundJobRecord<TId>
{
    private readonly IBackgroundJobStore<TId, TJob> _store;
    private readonly int _maxParallelExecutions;
    private readonly int _jobTimeoutSeconds;

    /// <summary>
    /// Initializes wait estimator dependencies.
    /// </summary>
    /// <param name="store">The job store instance.</param>
    /// <param name="maxParallelExecutions">Maximum concurrent executions.</param>
    /// <param name="jobTimeoutSeconds">Configured timeout used as rough batch cost.</param>
    public BackgroundJobWaitEstimator(IBackgroundJobStore<TId, TJob> store, int maxParallelExecutions, int jobTimeoutSeconds)
    {
        _store = store;
        _maxParallelExecutions = Math.Max(1, maxParallelExecutions);
        _jobTimeoutSeconds = Math.Max(1, jobTimeoutSeconds);
    }

    /// <summary>
    /// Estimates queue waiting time for the specified job id.
    /// </summary>
    /// <param name="jobId">The job id to estimate wait for.</param>
    /// <returns>Estimated wait in seconds, or <see langword="null"/> when unavailable.</returns>
    public int? EstimateWaitSeconds(TId jobId)
    {
        if (!_store.TryGet(jobId, out var job) || job is null || job.Status != BackgroundJobStatus.Queued)
        {
            return null;
        }

        var jobs = _store.GetAll();
        var queuedAhead = jobs.Count(x => x.Status == BackgroundJobStatus.Queued && x.QueueSequence < job.QueueSequence);
        var runningCount = jobs.Count(x => x.Status == BackgroundJobStatus.Running);

        var availableSlots = Math.Max(0, _maxParallelExecutions - runningCount);
        var queuePosition = Math.Max(0, queuedAhead - availableSlots);
        var batches = (int)Math.Ceiling(queuePosition / (double)_maxParallelExecutions);

        return batches * _jobTimeoutSeconds;
    }
}

/// <summary>
/// Describes persisted job output artifact details.
/// </summary>
public sealed class JobResultWriteOutcome
{
    /// <summary>
    /// Gets or sets stored artifact file path.
    /// </summary>
    public required string FilePath { get; set; }

    /// <summary>
    /// Gets or sets uncompressed content size in bytes.
    /// </summary>
    public required long UncompressedSizeBytes { get; set; }

    /// <summary>
    /// Gets or sets stored file size in bytes.
    /// </summary>
    public required long StoredSizeBytes { get; set; }

    /// <summary>
    /// Gets or sets whether zip archive compression was applied.
    /// </summary>
    public required bool IsZip { get; set; }
}

/// <summary>
/// Writes line-based job results as plain text or gzip-compressed artifacts.
/// </summary>
public static class JobResultFileWriter
{
    /// <summary>
    /// Persists a line-based output file and returns size metadata.
    /// </summary>
    public static async Task<JobResultWriteOutcome> WriteLinesAsync(
        string directoryPath,
        string filePrefix,
        IReadOnlyList<string> lines,
        Encoding encoding,
        bool zipBeforeDownload,
        CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(directoryPath);

        var rawText = string.Join(Environment.NewLine, lines);
        var bytes = encoding.GetBytes(rawText);

        if (zipBeforeDownload)
        {
            var zipPath = Path.Combine(directoryPath, filePrefix + ".zip");
            await using (var stream = File.Create(zipPath))
            using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: false))
            {
                var entry = archive.CreateEntry(filePrefix + ".txt", CompressionLevel.Optimal);
                await using var entryStream = entry.Open();
                await entryStream.WriteAsync(bytes.AsMemory(0, bytes.Length), cancellationToken);
            }

            var storedBytes = new FileInfo(zipPath).Length;
            return new JobResultWriteOutcome
            {
                FilePath = zipPath,
                UncompressedSizeBytes = bytes.LongLength,
                StoredSizeBytes = storedBytes,
                IsZip = true
            };
        }

        var textPath = Path.Combine(directoryPath, filePrefix + ".txt");
        await File.WriteAllBytesAsync(textPath, bytes, cancellationToken);
        return new JobResultWriteOutcome
        {
            FilePath = textPath,
            UncompressedSizeBytes = bytes.LongLength,
            StoredSizeBytes = bytes.LongLength,
            IsZip = false
        };
    }
}
