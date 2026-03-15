using Ramn.Labs.Frontend;
using Ramn.Labs.Backend.Features.Compression;
using Ramn.Labs.Backend.Features.Jobs;
using Ramn.Labs.Backend.Features.PolyHasher;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();
builder.Services
    .AddRazorPages()
    .AddApplicationPart(typeof(FrontendAssemblyMarker).Assembly);
builder.Services.Configure<CompressionOptions>(builder.Configuration.GetSection("Compression"));
builder.Services.Configure<PolyHasherOptions>(builder.Configuration.GetSection("PolyHasher"));
builder.Services.AddSingleton<IBackgroundJobStore<Guid, CompressionJobRecord>, InMemoryBackgroundJobStore<Guid, CompressionJobRecord>>();
builder.Services.AddSingleton<ICompressionJobQueue>(serviceProvider =>
{
    var options = serviceProvider.GetRequiredService<IOptions<CompressionOptions>>().Value;
    return new CompressionJobQueue(options.QueueCapacity);
});
builder.Services.AddSingleton<IGeohashCompressionService, GeoRaptorCompressionService>();
builder.Services.AddSingleton<GeohashInputParser>();
builder.Services.AddSingleton<BackgroundJobWaitEstimator<Guid, CompressionJobRecord>>(serviceProvider =>
{
    var options = serviceProvider.GetRequiredService<IOptions<CompressionOptions>>().Value;
    var store = serviceProvider.GetRequiredService<IBackgroundJobStore<Guid, CompressionJobRecord>>();
    return new BackgroundJobWaitEstimator<Guid, CompressionJobRecord>(store, options.MaxParallelExecutions, options.JobTimeoutSeconds);
});
builder.Services.AddSingleton<IBackgroundJobStore<Guid, PolyHasherJobRecord>, InMemoryBackgroundJobStore<Guid, PolyHasherJobRecord>>();
builder.Services.AddSingleton<IPolyHasherJobQueue>(serviceProvider =>
{
    var options = serviceProvider.GetRequiredService<IOptions<PolyHasherOptions>>().Value;
    return new PolyHasherJobQueue(options.QueueCapacity);
});
builder.Services.AddSingleton<IPolyHasherService, PolyHasherService>();
builder.Services.AddSingleton<BackgroundJobWaitEstimator<Guid, PolyHasherJobRecord>>(serviceProvider =>
{
    var options = serviceProvider.GetRequiredService<IOptions<PolyHasherOptions>>().Value;
    var store = serviceProvider.GetRequiredService<IBackgroundJobStore<Guid, PolyHasherJobRecord>>();
    return new BackgroundJobWaitEstimator<Guid, PolyHasherJobRecord>(store, options.MaxParallelExecutions, options.JobTimeoutSeconds);
});
builder.Services.AddHostedService<CompressionWorker>();
builder.Services.AddHostedService<CompletedArtifactsCleanupService>();
builder.Services.AddHostedService<PolyHasherWorker>();
builder.Services.AddHostedService<PolyHasherCleanupService>();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();

app.UseRouting();

app.UseAuthorization();

app.MapStaticAssets();
app.MapRazorPages()
    .WithStaticAssets();

app.MapCompressionEndpoints();
app.MapPolyHasherEndpoints();

app.Run();
