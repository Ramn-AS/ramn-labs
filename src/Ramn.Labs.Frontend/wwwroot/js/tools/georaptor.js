document.addEventListener("alpine:init", () => {
    const statusCodes = {
        queued: 0,
        running: 1,
        completed: 2,
        failed: 3,
        timedOut: 4,
        dropped: 5
    };

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
        pollTimer: null,
        map: null,
        baseLayer: null,
        featureLayer: null,
        themeObserver: null,
        resizeHandler: null,
        basemapLabel: "CARTO",

        init() {
            window.requestAnimationFrame(() => {
                this.initializeMap();
                this.ensureMapSize();

                this.resizeHandler = () => {
                    this.ensureMapSize();
                };

                window.addEventListener("resize", this.resizeHandler);
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

            this.baseLayer = this.createCartoLayer(this.getAppliedTheme()).addTo(this.map);

            this.featureLayer = L.geoJSON([], {
                style: {
                    color: "#0d6efd",
                    weight: 2,
                    fillColor: "#0d6efd",
                    fillOpacity: 0.15
                }
            });
            this.featureLayer.addTo(this.map);

            this.themeObserver = new MutationObserver(() => {
                this.updateBasemapForTheme();
            });
            this.themeObserver.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ["data-bs-theme"]
            });

            this.ensureMapSize();
        },

        ensureMapSize() {
            if (!this.map) {
                return;
            }

            this.map.invalidateSize();
        },

        getAppliedTheme() {
            const value = document.documentElement.getAttribute("data-bs-theme");
            return value === "dark" ? "dark" : "light";
        },

        createCartoLayer(theme) {
            const styleName = theme === "dark" ? "dark_all" : "light_all";
            return L.tileLayer(`https://a.basemaps.cartocdn.com/${styleName}/{z}/{x}/{y}.png`, {
                attribution: '&copy; <a href="https://carto.com">CARTO</a>, &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>',
                maxZoom: 20
            });
        },

        createOsmLayer() {
            return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
                attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>',
                maxZoom: 20
            });
        },

        useOsmBasemap() {
            if (!this.baseLayer) {
                return;
            }

            this.basemapLabel = "OSM";
            this.map.removeLayer(this.baseLayer);
            this.baseLayer = this.createOsmLayer();
            this.baseLayer.addTo(this.map);
            this.ensureMapSize();
        },

        useCartoBasemap() {
            if (!this.baseLayer) {
                return;
            }

            this.basemapLabel = "CARTO";
            this.map.removeLayer(this.baseLayer);
            this.baseLayer = this.createCartoLayer(this.getAppliedTheme());
            this.baseLayer.addTo(this.map);
            this.ensureMapSize();
        },

        updateBasemapForTheme() {
            if (!this.baseLayer) {
                return;
            }

            this.useCartoBasemap();
        },

        toStatusCode(status) {
            if (Number.isInteger(status)) {
                return status;
            }

            if (typeof status !== "string") {
                return null;
            }

            const normalized = status.trim().toLowerCase();
            if (normalized === "queued") {
                return statusCodes.queued;
            }

            if (normalized === "running") {
                return statusCodes.running;
            }

            if (normalized === "completed") {
                return statusCodes.completed;
            }

            if (normalized === "failed") {
                return statusCodes.failed;
            }

            if (normalized === "timedout" || normalized === "timed_out" || normalized === "timed out") {
                return statusCodes.timedOut;
            }

            if (normalized === "dropped") {
                return statusCodes.dropped;
            }

            return null;
        },

        getStatusLabel(statusCode, fallback) {
            if (statusCode === statusCodes.queued) {
                return "Queued";
            }

            if (statusCode === statusCodes.running) {
                return "Running";
            }

            if (statusCode === statusCodes.completed) {
                return "Completed";
            }

            if (statusCode === statusCodes.failed) {
                return "Failed";
            }

            if (statusCode === statusCodes.timedOut) {
                return "TimedOut";
            }

            if (statusCode === statusCodes.dropped) {
                return "Dropped";
            }

            return typeof fallback === "string" ? fallback : "Unknown";
        },

        isSubmissionLocked() {
            if (!this.jobId) {
                return false;
            }

            const statusCode = this.toStatusCode(this.status);
            return statusCode === statusCodes.queued || statusCode === statusCodes.running;
        },

        formatDuration(milliseconds) {
            if (!Number.isFinite(milliseconds) || milliseconds < 0) {
                return "-";
            }

            if (milliseconds < 1000) {
                return `${Math.round(milliseconds)} ms`;
            }

            const seconds = milliseconds / 1000;
            if (seconds < 60) {
                return `${seconds.toFixed(2)} s`;
            }

            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds - (minutes * 60);
            return `${minutes}m ${remainingSeconds.toFixed(1)}s`;
        },

        formatBytes(bytes) {
            if (!Number.isFinite(bytes) || bytes < 0) {
                return "-";
            }

            if (bytes < 1024) {
                return `${bytes} B`;
            }

            if (bytes < (1024 * 1024)) {
                return `${(bytes / 1024).toFixed(1)} KB`;
            }

            return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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
            this.stopPolling();
            this.pollTimer = window.setInterval(() => {
                this.pollStatus();
            }, Math.max(1, this.pollAfterSeconds) * 1000);
            this.pollStatus();
        },

        stopPolling() {
            if (this.pollTimer) {
                window.clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
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
            if (!err || typeof err !== "object") {
                return false;
            }

            return err.name === "TypeError";
        },

        notifyBackendConnectionError() {
            if (window.appNotifications && typeof window.appNotifications.backendConnectionError === "function") {
                window.appNotifications.backendConnectionError();
            }
        },

        notifyCompletionToast() {
            if (!this.jobId || this.completedToastShownForJobId === this.jobId) {
                return;
            }

            this.completedToastShownForJobId = this.jobId;
            if (window.appNotifications && typeof window.appNotifications.success === "function") {
                window.appNotifications.success("Compression complete", "Your compression job finished successfully.");
            }
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

            if (this.resizeHandler) {
                window.removeEventListener("resize", this.resizeHandler);
                this.resizeHandler = null;
            }

            if (this.themeObserver) {
                this.themeObserver.disconnect();
                this.themeObserver = null;
            }

            if (this.map) {
                this.map.remove();
                this.map = null;
            }
        }
    }));
});
