using System.Globalization;
using System.Text;
using Geohash.GeoRaptor;
using Geohash.Polyhasher;
using Microsoft.Extensions.Options;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;
using Ramn.Labs.Backend.Features.Jobs;

namespace Ramn.Labs.Backend.Features.PolyHasher;

/// <summary>
/// Configures queue behavior and safety limits for PolyHasher jobs.
/// </summary>
public sealed class PolyHasherOptions
{
    /// <summary>
    /// Gets or sets the maximum number of queued jobs.
    /// </summary>
    public int QueueCapacity { get; set; } = 20;

    /// <summary>
    /// Gets or sets the maximum number of jobs running in parallel.
    /// </summary>
    public int MaxParallelExecutions { get; set; } = 4;

    /// <summary>
    /// Gets or sets execution timeout in seconds after a job starts running.
    /// </summary>
    public int JobTimeoutSeconds { get; set; } = 30;

    /// <summary>
    /// Gets or sets queued-job abandon threshold in seconds when no polling occurs.
    /// </summary>
    public int QueueAbandonSeconds { get; set; } = 120;

    /// <summary>
    /// Gets or sets the maximum accepted WKT input length.
    /// </summary>
    public int MaxInputWktLength { get; set; } = 300_000;

    /// <summary>
    /// Gets or sets the maximum number of generated geohashes.
    /// </summary>
    public int MaxOutputGeohashCount { get; set; } = 500_000;

    /// <summary>
    /// Gets or sets poll interval hint in seconds for clients.
    /// </summary>
    public int PollingIntervalSeconds { get; set; } = 2;

    /// <summary>
    /// Gets or sets the completed jobs relative folder path.
    /// </summary>
    public string CompletedJobsPath { get; set; } = "tools/polyhasher/jobs/completed";

    /// <summary>
    /// Gets or sets retention duration for completed artifacts.
    /// </summary>
    public int CompletedRetentionMinutes { get; set; } = 30;

    /// <summary>
    /// Gets or sets download file naming prefix.
    /// </summary>
    public string DownloadFileNamePrefix { get; set; } = "polyhashed-geohashes";

    /// <summary>
    /// Gets or sets the maximum number of geohashes returned inline in status payload.
    /// </summary>
    public int StatusPreviewLimit { get; set; } = 300;
}

/// <summary>
/// Defines normalized PolyHasher mode values used in requests.
/// </summary>
public static class PolyHasherModeValues
{
    /// <summary>
    /// Represents intersecting geohashes.
    /// </summary>
    public const string Intersects = "intersects";

    /// <summary>
    /// Represents fully-contained geohashes.
    /// </summary>
    public const string Contains = "contains";
}

/// <summary>
/// Specialized queue contract for PolyHasher jobs.
/// </summary>
public interface IPolyHasherJobQueue : IBackgroundJobQueue<Guid>
{
}

/// <summary>
/// Channel-backed PolyHasher queue implementation.
/// </summary>
public sealed class PolyHasherJobQueue : IPolyHasherJobQueue
{
    private readonly ChannelBackgroundJobQueue<Guid> _inner;

    /// <summary>
    /// Initializes a new instance of the <see cref="PolyHasherJobQueue"/> class.
    /// </summary>
    public PolyHasherJobQueue(int capacity)
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
/// Stores full state for one PolyHasher queued/running/completed job.
/// </summary>
public sealed class PolyHasherJobRecord : IBackgroundJobRecord<Guid>
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
    /// Gets or sets queue sequence number used by wait estimation.
    /// </summary>
    public long QueueSequence { get; set; }

    /// <summary>
    /// Gets or sets originating request IP address.
    /// </summary>
    public string RequestIpAddress { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets source WKT input.
    /// </summary>
    public string? WktInput { get; set; }

    /// <summary>
    /// Gets or sets the requested geohash precision.
    /// </summary>
    public int Precision { get; set; }

    /// <summary>
    /// Gets or sets selected PolyHasher mode value.
    /// </summary>
    public string Mode { get; set; } = PolyHasherModeValues.Intersects;

    /// <summary>
    /// Gets or sets whether output compression is enabled.
    /// </summary>
    public bool EnableCompression { get; set; }

    /// <summary>
    /// Gets or sets output geohash count.
    /// </summary>
    public int? GeohashCount { get; set; }

    /// <summary>
    /// Gets or sets optional processing error.
    /// </summary>
    public BackgroundJobErrorDetails? Error { get; set; }

    /// <summary>
    /// Gets or sets completed result file path.
    /// </summary>
    public string? ResultFilePath { get; set; }
}

/// <summary>
/// Request payload for creating PolyHasher jobs.
/// </summary>
public sealed class CreatePolyHasherJobRequest
{
    /// <summary>
    /// Gets or sets source geometry in WKT format.
    /// </summary>
    public string? Wkt { get; set; }

    /// <summary>
    /// Gets or sets geohash precision to generate.
    /// </summary>
    public int Precision { get; set; }

    /// <summary>
    /// Gets or sets PolyHasher mode value.
    /// </summary>
    public string Mode { get; set; } = PolyHasherModeValues.Intersects;

    /// <summary>
    /// Gets or sets whether output compression is enabled.
    /// </summary>
    public bool EnableCompression { get; set; }
}

/// <summary>
/// Response payload returned when a job is created.
/// </summary>
public sealed class CreatePolyHasherJobResponse
{
    /// <summary>
    /// Gets or sets created job id.
    /// </summary>
    public required Guid JobId { get; set; }

    /// <summary>
    /// Gets or sets initial job status.
    /// </summary>
    public required BackgroundJobStatus Status { get; set; }

    /// <summary>
    /// Gets or sets creation timestamp in UTC.
    /// </summary>
    public required DateTimeOffset CreatedAtUtc { get; set; }
}

/// <summary>
/// Response payload for PolyHasher job status polling.
/// </summary>
public sealed class PolyHasherJobStatusResponse
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
    /// Gets or sets queue wait estimate in seconds while queued.
    /// </summary>
    public int? EstimatedWaitSeconds { get; set; }

    /// <summary>
    /// Gets or sets output geohash count when available.
    /// </summary>
    public int? GeohashCount { get; set; }

    /// <summary>
    /// Gets or sets whether download is available.
    /// </summary>
    public bool CanDownload { get; set; }

    /// <summary>
    /// Gets or sets backend processing duration in milliseconds when completed.
    /// </summary>
    public long? BackendDurationMilliseconds { get; set; }

    /// <summary>
    /// Gets or sets download file size in bytes when available.
    /// </summary>
    public long? DownloadSizeBytes { get; set; }

    /// <summary>
    /// Gets or sets geohash preview values when available.
    /// </summary>
    public List<string>? Geohashes { get; set; }

    /// <summary>
    /// Gets or sets whether not all generated values are included in preview.
    /// </summary>
    public bool PreviewTruncated { get; set; }

    /// <summary>
    /// Gets or sets optional structured error details.
    /// </summary>
    public BackgroundJobErrorDetails? Error { get; set; }
}

/// <summary>
/// Response payload containing queue counters.
/// </summary>
public sealed class PolyHasherQueueStatusResponse
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
/// Abstraction for converting geometries into geohash sets.
/// </summary>
public interface IPolyHasherService
{
    /// <summary>
    /// Converts WKT geometry to geohashes at requested precision and mode.
    /// </summary>
    HashSet<string> Encode(string wkt, int precision, PolyhasherMode mode);
}

/// <summary>
/// PolyHasher service implementation backed by Geohash.Polyhasher.
/// </summary>
public sealed class PolyHasherService : IPolyHasherService
{
    private readonly Polyhasher _polyhasher = new();
    private readonly WKTReader _wktReader = new();

    /// <inheritdoc />
    public HashSet<string> Encode(string wkt, int precision, PolyhasherMode mode)
    {
        Geometry geometry;
        try
        {
            geometry = _wktReader.Read(wkt);
        }
        catch (Exception ex)
        {
            throw new PolyHasherValidationException("invalid_wkt", $"Input WKT is invalid. {ex.Message}");
        }

        return _polyhasher.Encode(geometry, precision, mode);
    }
}

/// <summary>
/// Exception used for validation failures exposed to API clients.
/// </summary>
public sealed class PolyHasherValidationException : Exception
{
    /// <summary>
    /// Initializes a new instance of the <see cref="PolyHasherValidationException"/> class.
    /// </summary>
    public PolyHasherValidationException(string errorCode, string message)
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
/// Validates PolyHasher request values.
/// </summary>
public static class PolyHasherRequestValidator
{
    /// <summary>
    /// Validates and normalizes mode value.
    /// </summary>
    public static PolyhasherMode ValidateAndParseMode(string? mode)
    {
        var normalized = (mode ?? PolyHasherModeValues.Intersects).Trim().ToLowerInvariant();
        return normalized switch
        {
            PolyHasherModeValues.Intersects => PolyhasherMode.Intersects,
            PolyHasherModeValues.Contains => PolyhasherMode.Contains,
            _ => throw new PolyHasherValidationException(
                "invalid_mode",
                $"Mode must be '{PolyHasherModeValues.Intersects}' or '{PolyHasherModeValues.Contains}'.")
        };
    }

    /// <summary>
    /// Validates precision bounds for PolyHasher input.
    /// </summary>
    public static void ValidatePrecision(int precision)
    {
        if (precision < 1)
        {
            throw new PolyHasherValidationException("invalid_precision", "Precision must be at least 1.");
        }

        if (precision > 12)
        {
            throw new PolyHasherValidationException("invalid_precision", "Precision cannot be greater than 12.");
        }
    }

    /// <summary>
    /// Validates WKT input value against configured limits.
    /// </summary>
    public static string ValidateAndNormalizeWkt(string? wkt, PolyHasherOptions options)
    {
        if (string.IsNullOrWhiteSpace(wkt))
        {
            throw new PolyHasherValidationException("wkt_empty", "WKT input is required.");
        }

        var normalized = wkt.Trim();
        if (normalized.Length > Math.Max(100, options.MaxInputWktLength))
        {
            throw new PolyHasherValidationException(
                "wkt_too_large",
                $"WKT input exceeds limit {options.MaxInputWktLength} characters.");
        }

        return normalized;
    }
}

/// <summary>
/// Performs PolyHasher work in the background with bounded parallelism.
/// </summary>
public sealed class PolyHasherWorker : BackgroundService
{
    private const int CompressionMinPrecision = 1;

    private readonly IPolyHasherJobQueue _queue;
    private readonly IBackgroundJobStore<Guid, PolyHasherJobRecord> _store;
    private readonly IPolyHasherService _polyHasherService;
    private readonly PolyHasherOptions _options;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<PolyHasherWorker> _logger;
    private readonly SemaphoreSlim _parallelSemaphore;

    /// <summary>
    /// Initializes worker dependencies.
    /// </summary>
    public PolyHasherWorker(
        IPolyHasherJobQueue queue,
        IBackgroundJobStore<Guid, PolyHasherJobRecord> store,
        IPolyHasherService polyHasherService,
        IOptions<PolyHasherOptions> options,
        IWebHostEnvironment environment,
        ILogger<PolyHasherWorker> logger)
    {
        _queue = queue;
        _store = store;
        _polyHasherService = polyHasherService;
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
            _logger.LogError(ex, "Unhandled polyhasher job error for {JobId}", jobId);
            if (_store.TryGet(jobId, out var job) && job is not null)
            {
                job.Status = BackgroundJobStatus.Failed;
                job.CompletedAtUtc = DateTimeOffset.UtcNow;
                job.Error = new BackgroundJobErrorDetails
                {
                    ErrorCode = "job_failed_unhandled",
                    Message = "PolyHasher failed due to an unexpected backend error."
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
            job.WktInput = null;
            return;
        }

        job.Status = BackgroundJobStatus.Running;
        job.StartedAtUtc = DateTimeOffset.UtcNow;

        using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(Math.Max(1, _options.JobTimeoutSeconds)));
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken, timeoutCts.Token);

        try
        {
            var computeTask = Task.Run(() =>
            {
                var parsedMode = PolyHasherRequestValidator.ValidateAndParseMode(job.Mode);
                var output = _polyHasherService.Encode(job.WktInput ?? string.Empty, job.Precision, parsedMode);

                if (job.EnableCompression)
                {
                    output = GeoRaptor.Compress(output, CompressionMinPrecision, job.Precision);
                }

                if (output.Count > Math.Max(1, _options.MaxOutputGeohashCount))
                {
                    throw new PolyHasherValidationException(
                        "output_geohash_count_exceeded",
                        $"Generated geohash count {output.Count} exceeds limit {_options.MaxOutputGeohashCount}.");
                }

                return output.OrderBy(x => x, StringComparer.Ordinal).ToArray();
            }, CancellationToken.None);

            var sorted = await computeTask.WaitAsync(linkedCts.Token);

            var rootPath = Path.Combine(_environment.ContentRootPath, _options.CompletedJobsPath);
            Directory.CreateDirectory(rootPath);

            var stamp = DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);
            var filePrefix = $"{_options.DownloadFileNamePrefix}-{stamp}-{job.JobId}";
            var resultPath = Path.Combine(rootPath, filePrefix + ".txt");

            await File.WriteAllLinesAsync(resultPath, sorted, Encoding.ASCII, linkedCts.Token);

            job.ResultFilePath = resultPath;
            job.GeohashCount = sorted.Length;
            job.Status = BackgroundJobStatus.Completed;
            job.CompletedAtUtc = DateTimeOffset.UtcNow;
            job.Error = null;
            job.WktInput = null;
        }
        catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested && !stoppingToken.IsCancellationRequested)
        {
            job.Status = BackgroundJobStatus.TimedOut;
            job.CompletedAtUtc = DateTimeOffset.UtcNow;
            job.Error = new BackgroundJobErrorDetails
            {
                ErrorCode = "job_execution_timeout",
                Message = "PolyHasher timed out while running.",
                Details =
                {
                    ["jobTimeoutSeconds"] = _options.JobTimeoutSeconds.ToString(CultureInfo.InvariantCulture),
                    ["hint"] = "Try reducing geometry complexity or precision."
                }
            };
            job.WktInput = null;
        }
        catch (PolyHasherValidationException ex)
        {
            job.Status = BackgroundJobStatus.Failed;
            job.CompletedAtUtc = DateTimeOffset.UtcNow;
            job.Error = new BackgroundJobErrorDetails
            {
                ErrorCode = ex.ErrorCode,
                Message = ex.Message
            };
            job.WktInput = null;
        }
    }
}

/// <summary>
/// Deletes expired completed artifacts and removes stale completed jobs.
/// </summary>
public sealed class PolyHasherCleanupService : BackgroundService
{
    private readonly IBackgroundJobStore<Guid, PolyHasherJobRecord> _store;
    private readonly PolyHasherOptions _options;

    /// <summary>
    /// Initializes cleanup service dependencies.
    /// </summary>
    public PolyHasherCleanupService(IBackgroundJobStore<Guid, PolyHasherJobRecord> store, IOptions<PolyHasherOptions> options)
    {
        _store = store;
        _options = options.Value;
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            CleanupExpiredCompletedJobs();
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
            _store.TryRemove(job.JobId, out _);
        }
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
/// Maps PolyHasher API endpoints.
/// </summary>
public static class PolyHasherEndpoints
{
    private static long _queueSequence;

    /// <summary>
    /// Registers PolyHasher API endpoints.
    /// </summary>
    public static IEndpointRouteBuilder MapPolyHasherEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/polyhasher-jobs");

        group.MapPost("/", CreateJobAsync);
        group.MapGet("/{jobId:guid}", GetJobStatusAsync);
        group.MapGet("/queue-status", GetQueueStatusAsync);
        group.MapGet("/queue-status/fragment", GetQueueStatusFragmentAsync);
        group.MapGet("/{jobId:guid}/download", DownloadCompletedJobAsync);

        return app;
    }

    private static async Task<IResult> CreateJobAsync(
        HttpContext httpContext,
        IPolyHasherJobQueue queue,
        IBackgroundJobStore<Guid, PolyHasherJobRecord> store,
        IOptions<PolyHasherOptions> options,
        CancellationToken cancellationToken)
    {
        try
        {
            string? wkt = null;
            int precision;
            string? mode = null;
            var enableCompression = false;

            if (httpContext.Request.HasFormContentType)
            {
                var form = await httpContext.Request.ReadFormAsync(cancellationToken);
                wkt = form["wkt"].FirstOrDefault();
                mode = form["mode"].FirstOrDefault();
                var enableCompressionValue = form["enableCompression"].FirstOrDefault();
                if (!string.IsNullOrWhiteSpace(enableCompressionValue))
                {
                    enableCompression = enableCompressionValue.Trim().ToLowerInvariant() switch
                    {
                        "true" => true,
                        "1" => true,
                        "on" => true,
                        "yes" => true,
                        _ => false
                    };
                }

                if (!int.TryParse(form["precision"], NumberStyles.Integer, CultureInfo.InvariantCulture, out precision))
                {
                    throw new PolyHasherValidationException("invalid_precision", "Precision is required.");
                }
            }
            else
            {
                var request = await httpContext.Request.ReadFromJsonAsync<CreatePolyHasherJobRequest>(cancellationToken: cancellationToken)
                              ?? throw new PolyHasherValidationException("invalid_payload", "Request body is missing.");
                wkt = request.Wkt;
                precision = request.Precision;
                mode = request.Mode;
                enableCompression = request.EnableCompression;
            }

            var config = options.Value;
            var normalizedWkt = PolyHasherRequestValidator.ValidateAndNormalizeWkt(wkt, config);
            PolyHasherRequestValidator.ValidatePrecision(precision);
            _ = PolyHasherRequestValidator.ValidateAndParseMode(mode);
            var normalizedMode = (mode ?? PolyHasherModeValues.Intersects).Trim().ToLowerInvariant();
            var requestIpAddress = ResolveRequestIpAddress(httpContext);

            var existingActiveJob = store.GetAll().FirstOrDefault(x =>
                string.Equals(x.RequestIpAddress, requestIpAddress, StringComparison.Ordinal)
                && (x.Status == BackgroundJobStatus.Queued || x.Status == BackgroundJobStatus.Running));

            if (existingActiveJob is not null)
            {
                return Results.Json(new BackgroundJobErrorDetails
                {
                    ErrorCode = "ip_active_job_exists",
                    Message = "Only one active polyhasher job is allowed per IP address.",
                    Details =
                    {
                        ["jobId"] = existingActiveJob.JobId.ToString(),
                        ["status"] = existingActiveJob.Status.ToString(),
                        ["ipAddress"] = requestIpAddress
                    }
                }, statusCode: StatusCodes.Status429TooManyRequests);
            }

            var jobId = Guid.NewGuid();
            var createdAt = DateTimeOffset.UtcNow;
            var job = new PolyHasherJobRecord
            {
                JobId = jobId,
                Status = BackgroundJobStatus.Queued,
                CreatedAtUtc = createdAt,
                QueuedAtUtc = createdAt,
                LastPolledAtUtc = createdAt,
                QueueSequence = Interlocked.Increment(ref _queueSequence),
                RequestIpAddress = requestIpAddress,
                WktInput = normalizedWkt,
                Precision = precision,
                Mode = normalizedMode,
                EnableCompression = enableCompression
            };

            store.Add(job);

            if (!queue.TryEnqueue(jobId))
            {
                store.TryRemove(jobId, out _);

                var queueStatus = BuildQueueStatus(store, config);
                return Results.Json(new BackgroundJobErrorDetails
                {
                    ErrorCode = "queue_full",
                    Message = "PolyHasher queue is currently full.",
                    Details =
                    {
                        ["queueCapacity"] = config.QueueCapacity.ToString(CultureInfo.InvariantCulture),
                        ["queuedCount"] = queueStatus.QueuedCount.ToString(CultureInfo.InvariantCulture),
                        ["runningCount"] = queueStatus.RunningCount.ToString(CultureInfo.InvariantCulture)
                    }
                }, statusCode: StatusCodes.Status429TooManyRequests);
            }

            return Results.Accepted($"/api/polyhasher-jobs/{jobId}", new CreatePolyHasherJobResponse
            {
                JobId = jobId,
                Status = BackgroundJobStatus.Queued,
                CreatedAtUtc = createdAt
            });
        }
        catch (PolyHasherValidationException ex)
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
        IBackgroundJobStore<Guid, PolyHasherJobRecord> store,
        BackgroundJobWaitEstimator<Guid, PolyHasherJobRecord> waitEstimator,
        IOptions<PolyHasherOptions> options)
    {
        if (!store.TryGet(jobId, out var job) || job is null)
        {
            return Results.NotFound();
        }

        job.LastPolledAtUtc = DateTimeOffset.UtcNow;

        var config = options.Value;
        var response = new PolyHasherJobStatusResponse
        {
            JobId = job.JobId,
            Status = job.Status,
            Message = BuildStatusMessage(job.Status),
            PollAfterSeconds = Math.Max(1, config.PollingIntervalSeconds),
            EstimatedWaitSeconds = waitEstimator.EstimateWaitSeconds(job.JobId),
            GeohashCount = job.GeohashCount,
            CanDownload = job.Status == BackgroundJobStatus.Completed && !string.IsNullOrWhiteSpace(job.ResultFilePath),
            BackendDurationMilliseconds = job.StartedAtUtc.HasValue && job.CompletedAtUtc.HasValue
                ? (long)(job.CompletedAtUtc.Value - job.StartedAtUtc.Value).TotalMilliseconds
                : null,
            Error = job.Error
        };

        if (response.CanDownload && !string.IsNullOrWhiteSpace(job.ResultFilePath) && File.Exists(job.ResultFilePath))
        {
            var previewLimit = Math.Max(1, config.StatusPreviewLimit);
            var lines = File.ReadLines(job.ResultFilePath).Take(previewLimit + 1).ToList();
            response.PreviewTruncated = lines.Count > previewLimit;
            response.Geohashes = lines.Take(previewLimit).ToList();
            response.DownloadSizeBytes = new FileInfo(job.ResultFilePath).Length;
        }

        return Results.Ok(response);
    }

    private static IResult GetQueueStatusAsync(IBackgroundJobStore<Guid, PolyHasherJobRecord> store, IOptions<PolyHasherOptions> options)
    {
        var response = BuildQueueStatus(store, options.Value);
        return Results.Ok(response);
    }

    private static IResult GetQueueStatusFragmentAsync(IBackgroundJobStore<Guid, PolyHasherJobRecord> store, IOptions<PolyHasherOptions> options)
    {
        var response = BuildQueueStatus(store, options.Value);
        var html = $"<div class=\"small text-muted\">Queued: <strong>{response.QueuedCount}</strong> | Running: <strong>{response.RunningCount}</strong> / {response.MaxParallelExecutions}</div>";
        return Results.Content(html, "text/html");
    }

    private static IResult DownloadCompletedJobAsync(Guid jobId, IBackgroundJobStore<Guid, PolyHasherJobRecord> store, IOptions<PolyHasherOptions> options)
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
        var fileName = $"{options.Value.DownloadFileNamePrefix}-{timestamp}-{job.JobId}.txt";

        var stream = File.OpenRead(job.ResultFilePath);
        return Results.File(stream, "text/plain; charset=us-ascii", fileName, enableRangeProcessing: false);
    }

    private static PolyHasherQueueStatusResponse BuildQueueStatus(IBackgroundJobStore<Guid, PolyHasherJobRecord> store, PolyHasherOptions options)
    {
        var jobs = store.GetAll();
        return new PolyHasherQueueStatusResponse
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