document.addEventListener("alpine:init", () => {
    const tools = window.ramnLabsTools;
    if (!tools) {
        return;
    }

    const statusCodes = tools.statusCodes;

    Alpine.data("georaptorTool", () => ({
        minPrecision: 3,
        maxPrecision: 6,
        inputText: "",
        jobId: null,
        status: null,
        message: "Ready.",
        error: null,
        compressedCount: null,
        canDownload: false,
        downloadUrl: null,
        pollAfterSeconds: 2,
        estimatedWaitSeconds: null,
        backendDurationMilliseconds: null,
        downloadSizeBytes: null,
        canRenderGeometry: false,
        geometryCount: 0,
        isSubmitting: false,
        completedToastShownForJobId: null,
        pollController: null,
        map: null,
        mapThemeController: null,
        featureLayer: null,
        basemapLabel: "CARTO",

        init() {
            this.pollController = tools.createPollingController({
                getDelaySeconds: () => this.pollAfterSeconds,
                poll: () => this.pollStatus()
            });

            window.requestAnimationFrame(() => {
                this.initializeMap();
                this.ensureMapSize();
            });
        },

        initializeMap() {
            if (!this.$refs.map) {
                return;
            }

            this.map = L.map(this.$refs.map, {
                zoomControl: true,
                attributionControl: true,
                preferCanvas: false
            });

            this.map.setView([55, 12], 5);
            this.mapThemeController = tools.createLeafletThemeController(this.map);
            this.mapThemeController.init();

            this.featureLayer = L.geoJSON([], {
                style: {
                    color: "#0d6efd",
                    weight: 2,
                    fillColor: "#0d6efd",
                    fillOpacity: 0.15
                }
            });
            this.featureLayer.addTo(this.map);

            this.ensureMapSize();
        },

        ensureMapSize() {
            if (!this.mapThemeController) {
                return;
            }

            this.mapThemeController.ensureMapSize();
        },

        useOsmBasemap() {
            if (!this.mapThemeController) {
                return;
            }

            this.basemapLabel = "OSM";
            this.mapThemeController.useOsmBasemap();
        },

        useCartoBasemap() {
            if (!this.mapThemeController) {
                return;
            }

            this.basemapLabel = "CARTO";
            this.mapThemeController.useCartoBasemap();
        },

        updateBasemapForTheme() {
            this.useCartoBasemap();
        },

        toStatusCode(status) {
            return tools.toStatusCode(status);
        },

        getStatusLabel(statusCode, fallback) {
            return tools.getStatusLabel(statusCode, fallback);
        },

        isSubmissionLocked() {
            return tools.isSubmissionLocked(this.jobId, this.status);
        },

        formatDuration(milliseconds) {
            return tools.formatDuration(milliseconds);
        },

        formatBytes(bytes) {
            return tools.formatBytes(bytes);
        },

        async submitJob() {
            this.isSubmitting = true;
            this.error = null;
            this.message = "Submitting job...";
            this.completedToastShownForJobId = null;
            this.stopPolling();
            this.clearMap();

            try {
                const file = this.$refs.inputFile.files[0];
                const hasText = this.inputText.trim().length > 0;
                const hasFile = !!file;

                if (hasText === hasFile) {
                    throw new Error("Provide either pasted geohashes or a text file, but not both.");
                }

                const formData = new FormData();
                formData.append("minPrecision", String(this.minPrecision));
                formData.append("maxPrecision", String(this.maxPrecision));
                if (hasText) {
                    formData.append("inputText", this.inputText);
                }
                if (hasFile) {
                    formData.append("inputFile", file);
                }

                const response = await fetch("/api/compression-jobs/", {
                    method: "POST",
                    body: formData
                });

                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(payload.message || payload.errorCode || "Failed to create compression job.");
                }

                this.jobId = payload.jobId;
                this.status = payload.status;
                this.downloadUrl = `/api/compression-jobs/${this.jobId}/download`;
                this.message = "Job queued.";
                this.startPolling();
            }
            catch (err) {
                if (this.isConnectivityError(err)) {
                    this.notifyBackendConnectionError();
                }

                this.error = err.message || "Unable to submit job.";
                this.message = "Submission failed.";
            }
            finally {
                this.isSubmitting = false;
            }
        },

        startPolling() {
            if (!this.pollController) {
                return;
            }

            this.pollController.start();
        },

        stopPolling() {
            if (!this.pollController) {
                return;
            }

            this.pollController.stop();
        },

        async pollStatus() {
            if (!this.jobId) {
                return;
            }

            try {
                const response = await fetch(`/api/compression-jobs/${this.jobId}`);
                if (!response.ok) {
                    if (response.status >= 500) {
                        this.notifyBackendConnectionError();
                        this.message = "Backend unavailable. Retrying...";
                        return;
                    }

                    this.error = "Failed to fetch job status.";
                    this.stopPolling();
                    return;
                }

                const payload = await response.json();
                const statusCode = this.toStatusCode(payload.status);
                this.status = this.getStatusLabel(statusCode, payload.status);
                this.message = payload.message;
                this.pollAfterSeconds = payload.pollAfterSeconds || 2;
                this.estimatedWaitSeconds = payload.estimatedWaitSeconds;
                this.compressedCount = payload.compressedCount;
                this.backendDurationMilliseconds = payload.backendDurationMilliseconds ?? null;
                this.downloadSizeBytes = payload.downloadSizeBytes ?? null;
                this.canDownload = payload.canDownload;
                this.canRenderGeometry = payload.canRenderGeometry;

                if (payload.error) {
                    this.error = payload.error.message;
                }

                if (statusCode === statusCodes.completed) {
                    this.stopPolling();
                    if (Array.isArray(payload.geometries) && payload.geometries.length > 0) {
                        this.geometryCount = payload.geometries.length;
                        this.renderGeometries(payload.geometries);
                    }

                    this.notifyCompletionToast();
                }

                if (statusCode === statusCodes.timedOut || statusCode === statusCodes.failed || statusCode === statusCodes.dropped) {
                    this.stopPolling();
                    if (payload.error && payload.error.message) {
                        this.error = payload.error.message;
                    }
                }
            }
            catch (err) {
                if (this.isConnectivityError(err)) {
                    this.notifyBackendConnectionError();
                    this.message = "Backend unavailable. Retrying...";
                    return;
                }

                this.error = err.message || "Failed to fetch job status.";
                this.stopPolling();
            }
        },

        isConnectivityError(err) {
            return tools.isConnectivityError(err);
        },

        notifyBackendConnectionError() {
            tools.notifyBackendConnectionError();
        },

        notifyCompletionToast() {
            if (!this.jobId || this.completedToastShownForJobId === this.jobId) {
                return;
            }

            this.completedToastShownForJobId = this.jobId;
            tools.notifySuccess("Compression complete", "Your compression job finished successfully.");
        },

        renderGeometries(geometries) {
            this.clearMap();
            const features = [];
            for (const value of geometries) {
                const text = value.startsWith("SRID=4326;") ? value.substring("SRID=4326;".length) : value;
                try {
                    const geometry = wellknown.parse(text);
                    if (!geometry) {
                        continue;
                    }

                    features.push({
                        type: "Feature",
                        geometry,
                        properties: {}
                    });
                }
                catch {
                    // Skip invalid geometry rows while still rendering valid rows.
                }
            }

            if (features.length === 0) {
                return;
            }

            this.featureLayer.addData({
                type: "FeatureCollection",
                features
            });

            const bounds = this.featureLayer.getBounds();
            if (!bounds || !bounds.isValid()) {
                return;
            }

            this.ensureMapSize();
            this.map.fitBounds(bounds, {
                padding: [32, 32],
                maxZoom: 14,
                animate: true,
                duration: 0.3
            });
        },

        clearMap() {
            if (this.featureLayer) {
                this.featureLayer.clearLayers();
            }
            this.geometryCount = 0;
        },

        clearAll() {
            this.stopPolling();
            this.inputText = "";
            this.$refs.inputFile.value = "";
            this.jobId = null;
            this.status = null;
            this.message = "Ready.";
            this.error = null;
            this.compressedCount = null;
            this.canDownload = false;
            this.downloadUrl = null;
            this.estimatedWaitSeconds = null;
            this.backendDurationMilliseconds = null;
            this.downloadSizeBytes = null;
            this.canRenderGeometry = false;
            this.completedToastShownForJobId = null;
            this.clearMap();
        },

        destroy() {
            this.stopPolling();

            if (this.mapThemeController) {
                this.mapThemeController.dispose();
                this.mapThemeController = null;
            }

            if (this.map) {
                this.map.remove();
                this.map = null;
            }
        }
    }));
});
