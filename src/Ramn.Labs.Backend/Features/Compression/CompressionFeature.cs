using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Geohash.GeoRaptor;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Ramn.Labs.Backend.Features.Jobs;

namespace Ramn.Labs.Backend.Features.Compression;

/// <summary>
/// Configures compression queue, retention, and safety limits.
/// </summary>
public sealed class CompressionOptions
{
    /// <summary>
    /// Gets or sets maximum number of queued jobs.
    /// </summary>
    public int QueueCapacity { get; set; } = 20;

    /// <summary>
    /// Gets or sets maximum number of jobs running in parallel.
    /// </summary>
    public int MaxParallelExecutions { get; set; } = 4;

    /// <summary>
    /// Gets or sets per-job timeout in seconds after the job is running.
    /// </summary>
    public int JobTimeoutSeconds { get; set; } = 30;

    /// <summary>
    /// Gets or sets queued job abandon threshold in seconds when not polled.
    /// </summary>
    public int QueueAbandonSeconds { get; set; } = 120;

    /// <summary>
    /// Gets or sets maximum uploaded input file size.
    /// </summary>
    public long MaxInputFileBytes { get; set; } = 3_000_000;

    /// <summary>
    /// Gets or sets maximum number of geohashes allowed per request.
    /// </summary>
    public int MaxInputGeohashCount { get; set; } = 200_000;

    /// <summary>
    /// Gets or sets maximum number of geometries to return in status response.
    /// </summary>
    public int StatusPreviewLimit { get; set; } = 5_000;

    /// <summary>
    /// Gets or sets poll interval hint for clients.
    /// </summary>
    public int PollingIntervalSeconds { get; set; } = 2;

    /// <summary>
    /// Gets or sets the completed jobs relative folder path.
    /// </summary>
    public string CompletedJobsPath { get; set; } = "tools/georaptor/jobs/completed";

    /// <summary>
    /// Gets or sets retention duration for completed artifacts.
    /// </summary>
    public int CompletedRetentionMinutes { get; set; } = 30;

    /// <summary>
    /// Gets or sets download file naming prefix.
    /// </summary>
    public string DownloadFileNamePrefix { get; set; } = "compressed-geohashes";
}

/// <summary>
/// Specialized queue contract for compression jobs.
/// </summary>
public interface ICompressionJobQueue : IBackgroundJobQueue<Guid>
{
}

/// <summary>
/// Channel-backed compression queue implementation.
/// </summary>
public sealed class CompressionJobQueue : ICompressionJobQueue
{
    private readonly ChannelBackgroundJobQueue<Guid> _inner;

    /// <summary>
    /// Initializes a new instance of the <see cref="CompressionJobQueue"/> class.
    /// </summary>
    public CompressionJobQueue(int capacity)
    {
        _inner = new ChannelBackgroundJobQueue<Guid>(capacity);
    }

    /// <inheritdoc />
    public System.Threading.Channels.ChannelReader<Guid> Reader => _inner.Reader;

    /// <inheritdoc />
    public bool TryEnqueue(Guid jobId)
    {
        return _inner.TryEnqueue(jobId);
    }
}

/// <summary>
/// Stores full state for a queued/running/completed compression job.
/// </summary>
public sealed class CompressionJobRecord : IBackgroundJobRecord<Guid>
{
    /// <summary>
    /// Gets or sets the job id.
    /// </summary>
    public Guid JobId { get; set; }

    /// <summary>
    /// Gets or sets current job status.
    /// </summary>
    public BackgroundJobStatus Status { get; set; }

    /// <summary>
    /// Gets or sets creation timestamp in UTC.
    /// </summary>
    public DateTimeOffset CreatedAtUtc { get; set; }

    /// <summary>
    /// Gets or sets queue entry timestamp in UTC.
    /// </summary>
    public DateTimeOffset QueuedAtUtc { get; set; }

    /// <summary>
    /// Gets or sets running start timestamp in UTC.
    /// </summary>
    public DateTimeOffset? StartedAtUtc { get; set; }

    /// <summary>
    /// Gets or sets completion timestamp in UTC.
    /// </summary>
    public DateTimeOffset? CompletedAtUtc { get; set; }

    /// <summary>
    /// Gets or sets most recent poll timestamp in UTC.
    /// </summary>
    public DateTimeOffset LastPolledAtUtc { get; set; }

    /// <summary>
    /// Gets or sets queue sequence number for wait estimation.
    /// </summary>
    public long QueueSequence { get; set; }

    /// <summary>
    /// Gets or sets originating request IP address.
    /// </summary>
    public string RequestIpAddress { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets minimum precision.
    /// </summary>
    public int MinPrecision { get; set; }

    /// <summary>
    /// Gets or sets maximum precision.
    /// </summary>
    public int MaxPrecision { get; set; }

    /// <summary>
    /// Gets or sets validated input geohashes.
    /// </summary>
    public HashSet<string>? InputGeohashes { get; set; }

    /// <summary>
    /// Gets or sets output geohash count.
    /// </summary>
    public int? CompressedCount { get; set; }

    /// <summary>
    /// Gets or sets whether result file should be gzip-compressed.
    /// </summary>
    public bool ZipBeforeDownload { get; set; }

    /// <summary>
    /// Gets or sets optional processing error.
    /// </summary>
    public BackgroundJobErrorDetails? Error { get; set; }

    /// <summary>
    /// Gets or sets completed result file path.
    /// </summary>
    public string? ResultFilePath { get; set; }

    /// <summary>
    /// Gets or sets completed geometry file path.
    /// </summary>
    public string? GeometryFilePath { get; set; }
}

/// <summary>
/// Request body for creating compression jobs.
/// </summary>
public sealed class CreateCompressionJobRequest
{
    /// <summary>
    /// Gets or sets optional inline input text.
    /// </summary>
    public string? InputText { get; set; }

    /// <summary>
    /// Gets or sets minimum precision.
    /// </summary>
    public int MinPrecision { get; set; }

    /// <summary>
    /// Gets or sets maximum precision.
    /// </summary>
    public int MaxPrecision { get; set; }

    /// <summary>
    /// Gets or sets whether result file should be gzip-compressed.
    /// </summary>
    public bool ZipBeforeDownload { get; set; }
}

/// <summary>
/// Response for create job operation.
/// </summary>
public sealed class CreateCompressionJobResponse
{
    /// <summary>
    /// Gets or sets created job id.
    /// </summary>
    public required Guid JobId { get; set; }

    /// <summary>
    /// Gets or sets initial status.
    /// </summary>
    public required BackgroundJobStatus Status { get; set; }

    /// <summary>
    /// Gets or sets creation timestamp in UTC.
    /// </summary>
    public required DateTimeOffset CreatedAtUtc { get; set; }
}

/// <summary>
/// Response for polling job status.
/// </summary>
public sealed class CompressionJobStatusResponse
{
    /// <summary>
    /// Gets or sets the job id.
    /// </summary>
    public required Guid JobId { get; set; }

    /// <summary>
    /// Gets or sets status.
    /// </summary>
    public required BackgroundJobStatus Status { get; set; }

    /// <summary>
    /// Gets or sets status message.
    /// </summary>
    public required string Message { get; set; }

    /// <summary>
    /// Gets or sets poll hint in seconds.
    /// </summary>
    public required int PollAfterSeconds { get; set; }

    /// <summary>
    /// Gets or sets queue wait estimate in seconds.
    /// </summary>
    public int? EstimatedWaitSeconds { get; set; }

    /// <summary>
    /// Gets or sets output count when available.
    /// </summary>
    public int? CompressedCount { get; set; }

    /// <summary>
    /// Gets or sets backend processing duration in milliseconds when completed.
    /// </summary>
    public long? BackendDurationMilliseconds { get; set; }

    /// <summary>
    /// Gets or sets download file size in bytes when available.
    /// </summary>
    public long? DownloadSizeBytes { get; set; }

    /// <summary>
    /// Gets or sets whether geometry rendering is enabled.
    /// </summary>
    public bool CanRenderGeometry { get; set; }

    /// <summary>
    /// Gets or sets whether download is available.
    /// </summary>
    public bool CanDownload { get; set; }

    /// <summary>
    /// Gets or sets geometries in WKT format when enabled.
    /// </summary>
    public List<string>? Geometries { get; set; }

    /// <summary>
    /// Gets or sets whether not all geometries are included in preview.
    /// </summary>
    public bool PreviewTruncated { get; set; }

    /// <summary>
    /// Gets or sets optional structured error details.
    /// </summary>
    public BackgroundJobErrorDetails? Error { get; set; }
}

/// <summary>
/// Response containing queue status counters.
/// </summary>
public sealed class QueueStatusResponse
{
    /// <summary>
    /// Gets or sets queued job count.
    /// </summary>
    public int QueuedCount { get; set; }

    /// <summary>
    /// Gets or sets running job count.
    /// </summary>
    public int RunningCount { get; set; }

    /// <summary>
    /// Gets or sets max parallel execution count.
    /// </summary>
    public int MaxParallelExecutions { get; set; }
}

/// <summary>
/// Abstraction for compressing a geohash set.
/// </summary>
public interface IGeohashCompressionService
{
    /// <summary>
    /// Compresses geohashes using configured algorithm implementation.
    /// </summary>
    HashSet<string> Compress(HashSet<string> geohashes, int minPrecision, int maxPrecision);
}

/// <summary>
/// Compression service implementation backed by Geohash.GeoRaptor package.
/// </summary>
public sealed class GeoRaptorCompressionService : IGeohashCompressionService
{
    /// <inheritdoc />
    public HashSet<string> Compress(HashSet<string> geohashes, int minPrecision, int maxPrecision)
    {
        return GeoRaptor.Compress(geohashes, minPrecision, maxPrecision);
    }
}

/// <summary>
/// Parses and validates geohash inputs from text and uploaded files.
/// </summary>
public sealed class GeohashInputParser
{
    private static readonly Regex GeohashRegex = new("^[0123456789bcdefghjkmnpqrstuvwxyz]+$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private readonly CompressionOptions _options;

    /// <summary>
    /// Initializes parser with configured limits.
    /// </summary>
    public GeohashInputParser(IOptions<CompressionOptions> options)
    {
        _options = options.Value;
    }

    /// <summary>
    /// Parses geohashes from input text.
    /// </summary>
    public HashSet<string> ParseText(string input)
    {
        using var reader = new StringReader(input);
        return ParseLines(reader);
    }

    /// <summary>
    /// Parses geohashes from uploaded text file.
    /// </summary>
    public async Task<HashSet<string>> ParseFileAsync(IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length > _options.MaxInputFileBytes)
        {
            throw new CompressionValidationException("input_file_too_large", $"Input file exceeds limit {_options.MaxInputFileBytes} bytes.");
        }

        await using var stream = file.OpenReadStream();
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, leaveOpen: false);
        return await ParseLinesAsync(reader, cancellationToken);
    }

    private static string NormalizeLine(string line)
    {
        return line.Trim().ToLowerInvariant();
    }

    private HashSet<string> ParseLines(TextReader reader)
    {
        var lineNumber = 0;
        var values = new HashSet<string>(StringComparer.Ordinal);

        string? line;
        while ((line = reader.ReadLine()) is not null)
        {
            lineNumber++;
            ValidateAndAdd(line, lineNumber, values);
        }

        ValidateFinal(values);
        return values;
    }

    private async Task<HashSet<string>> ParseLinesAsync(TextReader reader, CancellationToken cancellationToken)
    {
        var lineNumber = 0;
        var values = new HashSet<string>(StringComparer.Ordinal);

        string? line;
        while ((line = await reader.ReadLineAsync(cancellationToken)) is not null)
        {
            lineNumber++;
            ValidateAndAdd(line, lineNumber, values);
        }

        ValidateFinal(values);
        return values;
    }

    private void ValidateAndAdd(string rawLine, int lineNumber, HashSet<string> values)
    {
        var line = NormalizeLine(rawLine);
        if (line.Length == 0)
        {
            throw new CompressionValidationException("input_contains_empty_line", $"Line {lineNumber} is empty. Input must be one geohash per line.");
        }

        if (!GeohashRegex.IsMatch(line))
        {
            throw new CompressionValidationException("input_contains_invalid_geohash", $"Line {lineNumber} contains invalid characters.");
        }

        values.Add(line);

        if (values.Count > _options.MaxInputGeohashCount)
        {
            throw new CompressionValidationException("input_geohash_count_exceeded", $"Input exceeds max geohash count {_options.MaxInputGeohashCount}.");
        }
    }

    private static void ValidatePrecision(int minPrecision, int maxPrecision)
    {
        if (minPrecision < 1)
        {
            throw new CompressionValidationException("invalid_min_precision", "Minimum precision must be at least 1.");
        }

        if (maxPrecision < minPrecision)
        {
            throw new CompressionValidationException("invalid_precision_range", "Maximum precision must be greater than or equal to minimum precision.");
        }

        if (maxPrecision > 12)
        {
            throw new CompressionValidationException("invalid_max_precision", "Maximum precision cannot be greater than 12.");
        }
    }

    private void ValidateFinal(HashSet<string> values)
    {
        if (values.Count == 0)
        {
            throw new CompressionValidationException("input_empty", "Input must contain at least one geohash.");
        }
    }

    /// <summary>
    /// Validates user supplied precision bounds.
    /// </summary>
    public static void ValidateRequestPrecision(int minPrecision, int maxPrecision)
    {
        ValidatePrecision(minPrecision, maxPrecision);
    }
}

/// <summary>
/// Exception used for validation failures exposed to API clients.
/// </summary>
public sealed class CompressionValidationException : Exception
{
    /// <summary>
    /// Initializes a new instance of the <see cref="CompressionValidationException"/> class.
    /// </summary>
    public CompressionValidationException(string errorCode, string message)
        : base(message)
    {
        ErrorCode = errorCode;
    }

    /// <summary>
    /// Gets stable error code value.
    /// </summary>
    public string ErrorCode { get; }
}

/// <summary>
/// Performs geohash compression work in the background with bounded parallelism.
/// </summary>
public sealed class CompressionWorker : BackgroundService
{
    private readonly ICompressionJobQueue _queue;
    private readonly IBackgroundJobStore<Guid, CompressionJobRecord> _store;
    private readonly IGeohashCompressionService _compressionService;
    private readonly CompressionOptions _options;
    private readonly ILogger<CompressionWorker> _logger;
    private readonly IWebHostEnvironment _environment;
    private readonly SemaphoreSlim _parallelSemaphore;

    /// <summary>
    /// Initializes worker dependencies.
    /// </summary>
    public CompressionWorker(
        ICompressionJobQueue queue,
        IBackgroundJobStore<Guid, CompressionJobRecord> store,
        IGeohashCompressionService compressionService,
        IOptions<CompressionOptions> options,
        IWebHostEnvironment environment,
        ILogger<CompressionWorker> logger)
    {
        _queue = queue;
        _store = store;
        _compressionService = compressionService;
        _options = options.Value;
        _environment = environment;
        _logger = logger;
        _parallelSemaphore = new SemaphoreSlim(Math.Max(1, _options.MaxParallelExecutions));
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var inFlight = new List<Task>();

        await foreach (var jobId in _queue.Reader.ReadAllAsync(stoppingToken))
        {
            await _parallelSemaphore.WaitAsync(stoppingToken);

            var task = ProcessJobSafeAsync(jobId, stoppingToken)
                .ContinueWith(_ => _parallelSemaphore.Release(), CancellationToken.None, TaskContinuationOptions.None, TaskScheduler.Default);

            inFlight.Add(task);
            inFlight.RemoveAll(x => x.IsCompleted);
        }

        await Task.WhenAll(inFlight);
    }

    private async Task ProcessJobSafeAsync(Guid jobId, CancellationToken stoppingToken)
    {
        try
        {
            await ProcessJobAsync(jobId, stoppingToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled compression job error for {JobId}", jobId);
            if (_store.TryGet(jobId, out var job) && job is not null)
            {
                job.Status = BackgroundJobStatus.Failed;
                job.CompletedAtUtc = DateTimeOffset.UtcNow;
                job.Error = new BackgroundJobErrorDetails
                {
                    ErrorCode = "job_failed_unhandled",
                    Message = "Compression failed due to an unexpected backend error."
                };
            }
        }
    }

    private async Task ProcessJobAsync(Guid jobId, CancellationToken stoppingToken)
    {
        if (!_store.TryGet(jobId, out var job) || job is null)
        {
            return;
        }

        var nowUtc = DateTimeOffset.UtcNow;
        var abandonAfter = TimeSpan.FromSeconds(Math.Max(1, _options.QueueAbandonSeconds));
        if (job.Status == BackgroundJobStatus.Queued && nowUtc - job.LastPolledAtUtc > abandonAfter)
        {
            job.Status = BackgroundJobStatus.Dropped;
            job.CompletedAtUtc = nowUtc;
            job.Error = new BackgroundJobErrorDetails
            {
                ErrorCode = "job_abandoned",
                Message = "Job was dropped because it was not polled while queued.",
                Details =
                {
                    ["queueAbandonSeconds"] = _options.QueueAbandonSeconds.ToString(CultureInfo.InvariantCulture)
                }
            };
            job.InputGeohashes = null;
            return;
        }

        job.Status = BackgroundJobStatus.Running;
        job.StartedAtUtc = DateTimeOffset.UtcNow;

        using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(Math.Max(1, _options.JobTimeoutSeconds)));
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken, timeoutCts.Token);

        try
        {
            var input = job.InputGeohashes ?? new HashSet<string>(StringComparer.Ordinal);
            var computeTask = Task.Run(() =>
            {
                var compressed = _compressionService.Compress(input, job.MinPrecision, job.MaxPrecision);
                return compressed
                    .OrderBy(x => x, StringComparer.Ordinal)
                    .ToArray();
            }, CancellationToken.None);

            var sorted = await computeTask.WaitAsync(linkedCts.Token);

            var rootPath = Path.Combine(_environment.ContentRootPath, _options.CompletedJobsPath);
            Directory.CreateDirectory(rootPath);

            var stamp = DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);
            var filePrefix = $"{_options.DownloadFileNamePrefix}-{stamp}-{job.JobId}";
            var geometryPath = Path.Combine(rootPath, filePrefix + ".wkt");
            var resultOutcome = await JobResultFileWriter.WriteLinesAsync(
                rootPath,
                filePrefix,
                sorted,
                Encoding.ASCII,
                job.ZipBeforeDownload,
                linkedCts.Token);

            var geometryLines = sorted.Select(x => $"SRID=4326;{GeometryWktSerializer.ToPolygonWkt(x)}").ToArray();
            await File.WriteAllLinesAsync(geometryPath, geometryLines, Encoding.UTF8, linkedCts.Token);

            job.ResultFilePath = resultOutcome.FilePath;
            job.GeometryFilePath = geometryPath;
            job.CompressedCount = sorted.Length;
            job.Status = BackgroundJobStatus.Completed;
            job.CompletedAtUtc = DateTimeOffset.UtcNow;
            job.Error = null;
            job.InputGeohashes = null;
        }
        catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested && !stoppingToken.IsCancellationRequested)
        {
            job.Status = BackgroundJobStatus.TimedOut;
            job.CompletedAtUtc = DateTimeOffset.UtcNow;
            job.Error = new BackgroundJobErrorDetails
            {
                ErrorCode = "job_execution_timeout",
                Message = "Compression timed out while running.",
                Details =
                {
                    ["jobTimeoutSeconds"] = _options.JobTimeoutSeconds.ToString(CultureInfo.InvariantCulture),
                    ["hint"] = "Try reducing input size or precision range."
                }
            };
            job.InputGeohashes = null;
        }
        catch (CompressionValidationException ex)
        {
            job.Status = BackgroundJobStatus.Failed;
            job.CompletedAtUtc = DateTimeOffset.UtcNow;
            job.Error = new BackgroundJobErrorDetails
            {
                ErrorCode = ex.ErrorCode,
                Message = ex.Message
            };
            job.InputGeohashes = null;
        }
    }
}

/// <summary>
/// Deletes expired completed artifacts and removes stale completed jobs.
/// </summary>
public sealed class CompletedArtifactsCleanupService : BackgroundService
{
    private readonly IBackgroundJobStore<Guid, CompressionJobRecord> _store;
    private readonly CompressionOptions _options;
    private readonly IWebHostEnvironment _environment;

    /// <summary>
    /// Initializes cleanup service dependencies.
    /// </summary>
    public CompletedArtifactsCleanupService(
        IBackgroundJobStore<Guid, CompressionJobRecord> store,
        IOptions<CompressionOptions> options,
        IWebHostEnvironment environment)
    {
        _store = store;
        _options = options.Value;
        _environment = environment;
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            CleanupExpiredCompletedJobs();
            CleanupOrphanedArtifacts();
            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        }
    }

    private void CleanupExpiredCompletedJobs()
    {
        var cutoff = DateTimeOffset.UtcNow.AddMinutes(-Math.Max(1, _options.CompletedRetentionMinutes));
        var jobs = _store.GetAll();

        foreach (var job in jobs)
        {
            if (job.Status != BackgroundJobStatus.Completed || job.CompletedAtUtc is null || job.CompletedAtUtc > cutoff)
            {
                continue;
            }

            TryDeleteFile(job.ResultFilePath);
            TryDeleteFile(job.GeometryFilePath);
            _store.TryRemove(job.JobId, out _);
        }
    }

    private void CleanupOrphanedArtifacts()
    {
        var cutoffUtc = DateTimeOffset.UtcNow.AddMinutes(-Math.Max(1, _options.CompletedRetentionMinutes));
        var rootPath = Path.Combine(_environment.ContentRootPath, _options.CompletedJobsPath);
        if (!Directory.Exists(rootPath))
        {
            return;
        }

        var trackedFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var job in _store.GetAll())
        {
            AddTrackedFile(trackedFiles, job.ResultFilePath);
            AddTrackedFile(trackedFiles, job.GeometryFilePath);
        }

        foreach (var filePath in Directory.EnumerateFiles(rootPath, "*", SearchOption.TopDirectoryOnly))
        {
            var fullPath = Path.GetFullPath(filePath);
            if (trackedFiles.Contains(fullPath))
            {
                continue;
            }

            var lastWriteUtc = File.GetLastWriteTimeUtc(fullPath);
            if (lastWriteUtc > cutoffUtc.UtcDateTime)
            {
                continue;
            }

            TryDeleteFile(fullPath);
        }
    }

    private static void AddTrackedFile(HashSet<string> trackedFiles, string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        trackedFiles.Add(Path.GetFullPath(path));
    }

    private static void TryDeleteFile(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        if (File.Exists(path))
        {
            File.Delete(path);
        }
    }
}

/// <summary>
/// Converts geohashes into WKT polygon envelopes in EPSG:4326.
/// </summary>
public static class GeometryWktSerializer
{
    private static readonly string Base32 = "0123456789bcdefghjkmnpqrstuvwxyz";

    /// <summary>
    /// Returns polygon WKT for geohash bounds.
    /// </summary>
    public static string ToPolygonWkt(string geohash)
    {
        var (minLon, minLat, maxLon, maxLat) = DecodeBounds(geohash);
        return FormattableString.Invariant($"POLYGON(({minLon} {minLat},{minLon} {maxLat},{maxLon} {maxLat},{maxLon} {minLat},{minLon} {minLat}))");
    }

    private static (double minLon, double minLat, double maxLon, double maxLat) DecodeBounds(string geohash)
    {
        var evenBit = true;
        var latMin = -90.0;
        var latMax = 90.0;
        var lonMin = -180.0;
        var lonMax = 180.0;

        foreach (var c in geohash)
        {
            var value = Base32.IndexOf(char.ToLowerInvariant(c));
            if (value < 0)
            {
                throw new CompressionValidationException("invalid_geohash_geometry", "Invalid geohash encountered during geometry generation.");
            }

            for (var bit = 4; bit >= 0; bit--)
            {
                var bitOn = ((value >> bit) & 1) == 1;
                if (evenBit)
                {
                    var mid = (lonMin + lonMax) / 2;
                    if (bitOn)
                    {
                        lonMin = mid;
                    }
                    else
                    {
                        lonMax = mid;
                    }
                }
                else
                {
                    var mid = (latMin + latMax) / 2;
                    if (bitOn)
                    {
                        latMin = mid;
                    }
                    else
                    {
                        latMax = mid;
                    }
                }

                evenBit = !evenBit;
            }
        }

        return (lonMin, latMin, lonMax, latMax);
    }
}

/// <summary>
/// Maps the compression API endpoints.
/// </summary>
public static class CompressionJobEndpoints
{
    private static long _queueSequence;

    /// <summary>
    /// Registers compression-related API endpoints.
    /// </summary>
    public static IEndpointRouteBuilder MapCompressionEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/compression-jobs");

        group.MapPost("/", CreateJobAsync);
        group.MapGet("/{jobId:guid}", GetJobStatusAsync);
        group.MapGet("/queue-status", GetQueueStatusAsync);
        group.MapGet("/queue-status/fragment", GetQueueStatusFragmentAsync);
        group.MapGet("/{jobId:guid}/download", DownloadCompletedJobAsync);

        return app;
    }

    private static async Task<IResult> CreateJobAsync(
        HttpContext httpContext,
        ICompressionJobQueue queue,
        IBackgroundJobStore<Guid, CompressionJobRecord> store,
        GeohashInputParser parser,
        IOptions<CompressionOptions> options,
        CancellationToken cancellationToken)
    {
        try
        {
            string? inputText = null;
            IFormFile? inputFile = null;
            int minPrecision;
            int maxPrecision;
            var zipBeforeDownload = false;

            if (httpContext.Request.HasFormContentType)
            {
                var form = await httpContext.Request.ReadFormAsync(cancellationToken);
                inputText = form["inputText"].FirstOrDefault();
                inputFile = form.Files.GetFile("inputFile");

                var zipValue = form["zipBeforeDownload"].FirstOrDefault();
                if (!string.IsNullOrWhiteSpace(zipValue))
                {
                    zipBeforeDownload = zipValue.Trim().ToLowerInvariant() switch
                    {
                        "true" => true,
                        "1" => true,
                        "on" => true,
                        "yes" => true,
                        _ => false
                    };
                }

                if (!int.TryParse(form["minPrecision"], NumberStyles.Integer, CultureInfo.InvariantCulture, out minPrecision)
                    || !int.TryParse(form["maxPrecision"], NumberStyles.Integer, CultureInfo.InvariantCulture, out maxPrecision))
                {
                    throw new CompressionValidationException("invalid_precision_range", "Min and max precision are required.");
                }
            }
            else
            {
                var request = await httpContext.Request.ReadFromJsonAsync<CreateCompressionJobRequest>(cancellationToken: cancellationToken)
                              ?? throw new CompressionValidationException("invalid_payload", "Request body is missing.");
                inputText = request.InputText;
                minPrecision = request.MinPrecision;
                maxPrecision = request.MaxPrecision;
                zipBeforeDownload = request.ZipBeforeDownload;
            }

            GeohashInputParser.ValidateRequestPrecision(minPrecision, maxPrecision);

            var requestIpAddress = ResolveRequestIpAddress(httpContext);
            var existingActiveJob = store.GetAll().FirstOrDefault(x =>
                string.Equals(x.RequestIpAddress, requestIpAddress, StringComparison.Ordinal)
                && (x.Status == BackgroundJobStatus.Queued || x.Status == BackgroundJobStatus.Running));

            if (existingActiveJob is not null)
            {
                return Results.Json(new BackgroundJobErrorDetails
                {
                    ErrorCode = "ip_active_job_exists",
                    Message = "Only one active compression job is allowed per IP address.",
                    Details =
                    {
                        ["jobId"] = existingActiveJob.JobId.ToString(),
                        ["status"] = existingActiveJob.Status.ToString(),
                        ["ipAddress"] = requestIpAddress
                    }
                }, statusCode: StatusCodes.Status429TooManyRequests);
            }

            var hasText = !string.IsNullOrWhiteSpace(inputText);
            var hasFile = inputFile is not null;
            if (hasText == hasFile)
            {
                throw new CompressionValidationException("invalid_input_source", "Provide either text input or file input, but not both.");
            }

            HashSet<string> geohashes;
            if (hasFile)
            {
                geohashes = await parser.ParseFileAsync(inputFile!, cancellationToken);
            }
            else
            {
                geohashes = parser.ParseText(inputText!);
            }

            var jobId = Guid.NewGuid();
            var createdAt = DateTimeOffset.UtcNow;
            var job = new CompressionJobRecord
            {
                JobId = jobId,
                Status = BackgroundJobStatus.Queued,
                CreatedAtUtc = createdAt,
                QueuedAtUtc = createdAt,
                LastPolledAtUtc = createdAt,
                QueueSequence = Interlocked.Increment(ref _queueSequence),
                RequestIpAddress = requestIpAddress,
                MinPrecision = minPrecision,
                MaxPrecision = maxPrecision,
                ZipBeforeDownload = zipBeforeDownload,
                InputGeohashes = geohashes
            };

            store.Add(job);

            if (!queue.TryEnqueue(jobId))
            {
                store.TryRemove(jobId, out _);

                var queueStatus = BuildQueueStatus(store, options.Value);
                return Results.Json(new BackgroundJobErrorDetails
                {
                    ErrorCode = "queue_full",
                    Message = "Compression queue is currently full.",
                    Details =
                    {
                        ["queueCapacity"] = options.Value.QueueCapacity.ToString(CultureInfo.InvariantCulture),
                        ["queuedCount"] = queueStatus.QueuedCount.ToString(CultureInfo.InvariantCulture),
                        ["runningCount"] = queueStatus.RunningCount.ToString(CultureInfo.InvariantCulture)
                    }
                }, statusCode: StatusCodes.Status429TooManyRequests);
            }

            return Results.Accepted($"/api/compression-jobs/{jobId}", new CreateCompressionJobResponse
            {
                JobId = jobId,
                Status = BackgroundJobStatus.Queued,
                CreatedAtUtc = createdAt
            });
        }
        catch (CompressionValidationException ex)
        {
            return Results.BadRequest(new BackgroundJobErrorDetails
            {
                ErrorCode = ex.ErrorCode,
                Message = ex.Message
            });
        }
    }

    private static IResult GetJobStatusAsync(
        Guid jobId,
        IBackgroundJobStore<Guid, CompressionJobRecord> store,
        BackgroundJobWaitEstimator<Guid, CompressionJobRecord> waitEstimator,
        IOptions<CompressionOptions> options)
    {
        if (!store.TryGet(jobId, out var job) || job is null)
        {
            return Results.NotFound();
        }

        job.LastPolledAtUtc = DateTimeOffset.UtcNow;

        var config = options.Value;
        var response = new CompressionJobStatusResponse
        {
            JobId = job.JobId,
            Status = job.Status,
            Message = BuildStatusMessage(job.Status),
            PollAfterSeconds = Math.Max(1, config.PollingIntervalSeconds),
            EstimatedWaitSeconds = waitEstimator.EstimateWaitSeconds(job.JobId),
            CompressedCount = job.CompressedCount,
            BackendDurationMilliseconds = job.StartedAtUtc.HasValue && job.CompletedAtUtc.HasValue
                ? (long)(job.CompletedAtUtc.Value - job.StartedAtUtc.Value).TotalMilliseconds
                : null,
            CanDownload = job.Status == BackgroundJobStatus.Completed && !string.IsNullOrWhiteSpace(job.ResultFilePath),
            CanRenderGeometry = job.Status == BackgroundJobStatus.Completed,
            Error = job.Error
        };

        if (response.CanDownload && !string.IsNullOrWhiteSpace(job.ResultFilePath) && File.Exists(job.ResultFilePath))
        {
            response.DownloadSizeBytes = new FileInfo(job.ResultFilePath).Length;
        }

        if (response.CanRenderGeometry && !string.IsNullOrWhiteSpace(job.GeometryFilePath) && File.Exists(job.GeometryFilePath))
        {
            var previewLimit = Math.Max(1, config.StatusPreviewLimit);
            var geometryLines = File.ReadLines(job.GeometryFilePath).Take(previewLimit + 1).ToList();
            response.PreviewTruncated = geometryLines.Count > previewLimit;
            response.Geometries = geometryLines.Take(previewLimit).ToList();
        }

        return Results.Ok(response);
    }

    private static IResult GetQueueStatusAsync(IBackgroundJobStore<Guid, CompressionJobRecord> store, IOptions<CompressionOptions> options)
    {
        var response = BuildQueueStatus(store, options.Value);
        return Results.Ok(response);
    }

    private static IResult GetQueueStatusFragmentAsync(IBackgroundJobStore<Guid, CompressionJobRecord> store, IOptions<CompressionOptions> options)
    {
        var response = BuildQueueStatus(store, options.Value);
        var html = $"<div class=\"small text-muted\">Queued: <strong>{response.QueuedCount}</strong> | Running: <strong>{response.RunningCount}</strong> / {response.MaxParallelExecutions}</div>";
        return Results.Content(html, "text/html");
    }

    private static IResult DownloadCompletedJobAsync(Guid jobId, IBackgroundJobStore<Guid, CompressionJobRecord> store, IOptions<CompressionOptions> options)
    {
        if (!store.TryGet(jobId, out var job) || job is null)
        {
            return Results.NotFound();
        }

        if (job.Status != BackgroundJobStatus.Completed || string.IsNullOrWhiteSpace(job.ResultFilePath) || !File.Exists(job.ResultFilePath))
        {
            return Results.BadRequest(new BackgroundJobErrorDetails
            {
                ErrorCode = "download_unavailable",
                Message = "Download is available only for completed jobs within retention period."
            });
        }

        var timestamp = (job.CompletedAtUtc ?? DateTimeOffset.UtcNow).ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);
        var isZip = string.Equals(Path.GetExtension(job.ResultFilePath), ".zip", StringComparison.OrdinalIgnoreCase);
        var fileName = isZip
            ? $"{options.Value.DownloadFileNamePrefix}-{timestamp}-{job.JobId}.zip"
            : $"{options.Value.DownloadFileNamePrefix}-{timestamp}-{job.JobId}.txt";

        var stream = File.OpenRead(job.ResultFilePath);
        var contentType = isZip ? "application/zip" : "text/plain; charset=us-ascii";
        return Results.File(stream, contentType, fileName, enableRangeProcessing: false);
    }

    private static QueueStatusResponse BuildQueueStatus(IBackgroundJobStore<Guid, CompressionJobRecord> store, CompressionOptions options)
    {
        var jobs = store.GetAll();
        return new QueueStatusResponse
        {
            QueuedCount = jobs.Count(x => x.Status == BackgroundJobStatus.Queued),
            RunningCount = jobs.Count(x => x.Status == BackgroundJobStatus.Running),
            MaxParallelExecutions = Math.Max(1, options.MaxParallelExecutions)
        };
    }

    private static string BuildStatusMessage(BackgroundJobStatus status)
    {
        return status switch
        {
            BackgroundJobStatus.Queued => "Job is queued.",
            BackgroundJobStatus.Running => "Job is running.",
            BackgroundJobStatus.Completed => "Job completed successfully.",
            BackgroundJobStatus.Failed => "Job failed.",
            BackgroundJobStatus.TimedOut => "Job timed out while running.",
            BackgroundJobStatus.Dropped => "Job was dropped after queue inactivity.",
            _ => "Unknown status."
        };
    }

    private static string ResolveRequestIpAddress(HttpContext httpContext)
    {
        var forwardedFor = httpContext.Request.Headers["X-Forwarded-For"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(forwardedFor))
        {
            var firstForwardedIp = forwardedFor.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(firstForwardedIp))
            {
                return firstForwardedIp;
            }
        }

        return httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    }
}
