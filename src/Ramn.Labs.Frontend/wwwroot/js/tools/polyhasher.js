document.addEventListener("alpine:init", () => {
    const statusCodes = {
        queued: 0,
        running: 1,
        completed: 2,
        failed: 3,
        timedOut: 4,
        dropped: 5
    };

    const geohashBase32 = "0123456789bcdefghjkmnpqrstuvwxyz";
    const geohashBits = [16, 8, 4, 2, 1];

    function normalizeWktInput(value) {
        if (typeof value !== "string") {
            return "";
        }

        const trimmed = value.trim();
        if (!trimmed) {
            return "";
        }

        if (trimmed.startsWith("SRID=4326;")) {
            return trimmed.substring("SRID=4326;".length).trim();
        }

        return trimmed;
    }

    function ensureClosedRing(ring) {
        if (!Array.isArray(ring) || ring.length === 0) {
            return [];
        }

        const normalized = [...ring];
        const first = normalized[0];
        const last = normalized[normalized.length - 1];
        if (!first || !last) {
            return [];
        }

        if (first.lat !== last.lat || first.lng !== last.lng) {
            normalized.push(first);
        }

        return normalized;
    }

    function latLngRingToWkt(ring) {
        const closedRing = ensureClosedRing(ring);
        if (closedRing.length < 4) {
            return null;
        }

        return closedRing.map((point) => `${point.lng} ${point.lat}`).join(", ");
    }

    function layerToPolygonWkt(layer) {
        if (!layer || typeof layer.getLatLngs !== "function") {
            return null;
        }

        const latLngs = layer.getLatLngs();
        if (!Array.isArray(latLngs) || latLngs.length === 0 || !Array.isArray(latLngs[0])) {
            return null;
        }

        const ringText = [];
        for (const ring of latLngs) {
            const wktRing = latLngRingToWkt(ring);
            if (wktRing) {
                ringText.push(`(${wktRing})`);
            }
        }

        if (ringText.length === 0) {
            return null;
        }

        return `POLYGON (${ringText.join(", ")})`;
    }

    function decodeGeohashBounds(geohash) {
        if (typeof geohash !== "string" || geohash.trim().length === 0) {
            return null;
        }

        let evenBit = true;
        const latRange = [-90.0, 90.0];
        const lonRange = [-180.0, 180.0];

        for (const char of geohash.trim().toLowerCase()) {
            const charIndex = geohashBase32.indexOf(char);
            if (charIndex < 0) {
                return null;
            }

            for (const bit of geohashBits) {
                if (evenBit) {
                    const midpoint = (lonRange[0] + lonRange[1]) / 2;
                    if ((charIndex & bit) !== 0) {
                        lonRange[0] = midpoint;
                    }
                    else {
                        lonRange[1] = midpoint;
                    }
                }
                else {
                    const midpoint = (latRange[0] + latRange[1]) / 2;
                    if ((charIndex & bit) !== 0) {
                        latRange[0] = midpoint;
                    }
                    else {
                        latRange[1] = midpoint;
                    }
                }

                evenBit = !evenBit;
            }
        }

        return {
            minLat: latRange[0],
            maxLat: latRange[1],
            minLon: lonRange[0],
            maxLon: lonRange[1]
        };
    }

    Alpine.data("polyhasherTool", () => ({
        wktInput: "",
        precision: 5,
        mode: "intersects",
        enableCompression: false,
        jobId: null,
        status: null,
        message: "Ready.",
        error: null,
        geohashCount: null,
        geohashes: [],
        previewTruncated: false,
        canDownload: false,
        downloadUrl: null,
        pollAfterSeconds: 2,
        estimatedWaitSeconds: null,
        backendDurationMilliseconds: null,
        downloadSizeBytes: null,
        isSubmitting: false,
        completedToastShownForJobId: null,
        pollTimer: null,
        map: null,
        baseLayer: null,
        inputGeometryLayer: null,
        geohashLayer: null,
        drawLayer: null,
        drawControl: null,
        themeObserver: null,
        resizeHandler: null,

        init() {
            window.requestAnimationFrame(() => {
                this.initializeMap();
                this.ensureMapSize();
                this.updateInputGeometryPreview(false);

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

            this.inputGeometryLayer = L.geoJSON([], {
                style: {
                    color: "#0d9488",
                    weight: 2,
                    fillColor: "#14b8a6",
                    fillOpacity: 0.18
                },
                interactive: false
            }).addTo(this.map);

            this.geohashLayer = L.layerGroup().addTo(this.map);
            this.drawLayer = new L.FeatureGroup().addTo(this.map);

            this.configureDrawingTools();

            this.themeObserver = new MutationObserver(() => {
                this.updateBasemapForTheme();
            });
            this.themeObserver.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ["data-bs-theme"]
            });
        },

        configureDrawingTools() {
            if (!this.map || !this.drawLayer || !L.Control || !L.Control.Draw) {
                return;
            }

            this.drawControl = new L.Control.Draw({
                edit: {
                    featureGroup: this.drawLayer,
                    remove: true
                },
                draw: {
                    polygon: {
                        allowIntersection: false,
                        showArea: true,
                        shapeOptions: {
                            color: "#0d9488",
                            weight: 2,
                            fillColor: "#14b8a6",
                            fillOpacity: 0.15
                        }
                    },
                    rectangle: {
                        shapeOptions: {
                            color: "#0d9488",
                            weight: 2,
                            fillColor: "#14b8a6",
                            fillOpacity: 0.15
                        }
                    },
                    polyline: false,
                    marker: false,
                    circle: false,
                    circlemarker: false
                }
            });

            this.map.addControl(this.drawControl);

            this.map.on(L.Draw.Event.CREATED, (event) => {
                this.drawLayer.clearLayers();
                this.drawLayer.addLayer(event.layer);
                this.updateWktFromDrawLayer(true);
            });

            this.map.on(L.Draw.Event.EDITED, () => {
                this.updateWktFromDrawLayer(true);
            });

            this.map.on(L.Draw.Event.DELETED, () => {
                this.updateWktFromDrawLayer(true);
            });
        },

        updateWktFromDrawLayer(fitBounds) {
            if (!this.drawLayer) {
                return;
            }

            let derivedWkt = null;
            this.drawLayer.eachLayer((layer) => {
                if (!derivedWkt) {
                    derivedWkt = layerToPolygonWkt(layer);
                }
            });

            this.wktInput = derivedWkt || "";
            if (derivedWkt) {
                this.message = "Input geometry updated from map drawing.";
                this.error = null;
            }

            this.updateInputGeometryPreview(fitBounds);
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

        useCartoBasemap() {
            if (!this.baseLayer || !this.map) {
                return;
            }

            this.map.removeLayer(this.baseLayer);
            this.baseLayer = this.createCartoLayer(this.getAppliedTheme());
            this.baseLayer.addTo(this.map);
            this.ensureMapSize();
        },

        updateBasemapForTheme() {
            this.useCartoBasemap();
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

        updateInputGeometryPreview(fitBounds) {
            if (!this.inputGeometryLayer) {
                return;
            }

            this.inputGeometryLayer.clearLayers();

            const normalizedWkt = normalizeWktInput(this.wktInput);
            if (!normalizedWkt) {
                return;
            }

            try {
                const geometry = wellknown.parse(normalizedWkt);
                if (!geometry) {
                    return;
                }

                this.inputGeometryLayer.addData({
                    type: "Feature",
                    geometry,
                    properties: {}
                });

                if (fitBounds) {
                    const bounds = this.inputGeometryLayer.getBounds();
                    if (bounds && bounds.isValid()) {
                        this.ensureMapSize();
                        this.map.fitBounds(bounds, {
                            padding: [32, 32],
                            maxZoom: 14,
                            animate: true,
                            duration: 0.25
                        });
                    }
                }
            }
            catch {
                // Keep typing smooth while users edit partial WKT text.
            }
        },

        renderGeohashPreview(fitBounds) {
            if (!this.geohashLayer) {
                return;
            }

            this.geohashLayer.clearLayers();

            if (!Array.isArray(this.geohashes) || this.geohashes.length === 0) {
                return;
            }

            let combinedBounds = null;
            for (const geohash of this.geohashes) {
                const bounds = decodeGeohashBounds(geohash);
                if (!bounds) {
                    continue;
                }

                const southWest = [bounds.minLat, bounds.minLon];
                const northEast = [bounds.maxLat, bounds.maxLon];
                const rectangle = L.rectangle([southWest, northEast], {
                    color: "#0d6efd",
                    weight: 1,
                    fillColor: "#0d6efd",
                    fillOpacity: 0.15,
                    interactive: false
                });

                rectangle.addTo(this.geohashLayer);

                const rectangleBounds = L.latLngBounds(southWest, northEast);
                combinedBounds = combinedBounds ? combinedBounds.extend(rectangleBounds) : rectangleBounds;
            }

            if (fitBounds && combinedBounds && combinedBounds.isValid()) {
                this.ensureMapSize();
                this.map.fitBounds(combinedBounds, {
                    padding: [28, 28],
                    maxZoom: 15,
                    animate: true,
                    duration: 0.25
                });
            }
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

        async submitJob() {
            this.isSubmitting = true;
            this.error = null;
            this.message = "Submitting job...";
            this.completedToastShownForJobId = null;
            this.stopPolling();
            this.geohashes = [];
            this.previewTruncated = false;
            this.geohashCount = null;
            this.renderGeohashPreview(false);
            this.updateInputGeometryPreview(false);

            try {
                const payload = {
                    wkt: this.wktInput,
                    precision: this.precision,
                    mode: this.mode,
                    enableCompression: this.enableCompression
                };

                const response = await fetch("/api/polyhasher-jobs/", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                });

                const body = await response.json();
                if (!response.ok) {
                    throw new Error(body.message || body.errorCode || "Failed to create polyhasher job.");
                }

                this.jobId = body.jobId;
                this.status = body.status;
                this.downloadUrl = `/api/polyhasher-jobs/${this.jobId}/download`;
                this.canDownload = false;
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
                const response = await fetch(`/api/polyhasher-jobs/${this.jobId}`);
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
                this.geohashCount = payload.geohashCount;
                this.canDownload = payload.canDownload;
                this.backendDurationMilliseconds = payload.backendDurationMilliseconds ?? null;
                this.downloadSizeBytes = payload.downloadSizeBytes ?? null;
                this.previewTruncated = payload.previewTruncated === true;
                this.geohashes = Array.isArray(payload.geohashes) ? payload.geohashes : [];
                this.renderGeohashPreview(statusCode === statusCodes.completed);

                if (payload.error) {
                    this.error = payload.error.message;
                }

                if (statusCode === statusCodes.completed) {
                    this.stopPolling();
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
                window.appNotifications.success("Polyhash complete", "Your polyhash job finished successfully.");
            }
        },

        clearAll() {
            this.stopPolling();
            this.wktInput = "";
            this.precision = 5;
            this.mode = "intersects";
            this.enableCompression = false;
            this.jobId = null;
            this.status = null;
            this.message = "Ready.";
            this.error = null;
            this.geohashCount = null;
            this.geohashes = [];
            this.previewTruncated = false;
            this.canDownload = false;
            this.downloadUrl = null;
            this.estimatedWaitSeconds = null;
            this.backendDurationMilliseconds = null;
            this.downloadSizeBytes = null;
            this.completedToastShownForJobId = null;
            this.renderGeohashPreview(false);
            this.updateInputGeometryPreview(false);

            if (this.drawLayer) {
                this.drawLayer.clearLayers();
            }
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
