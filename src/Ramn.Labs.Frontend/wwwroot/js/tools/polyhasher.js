document.addEventListener("alpine:init", () => {
    const tools = window.ramnLabsTools;
    const preferencesStore = window.preferencesStore;
    if (!tools) {
        return;
    }

    const statusCodes = tools.statusCodes;

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
        pollController: null,
        map: null,
        mapThemeController: null,
        inputGeometryLayer: null,
        geohashLayer: null,
        drawLayer: null,
        drawControl: null,
        mapMaximized: false,
        maximizedTopOffset: 0,
        resizeHandler: null,

        init() {
            this.pollController = tools.createPollingController({
                getDelaySeconds: () => this.pollAfterSeconds,
                poll: () => this.pollStatus()
            });

            this.mapMaximized = preferencesStore && typeof preferencesStore.getMapMaximizedPreference === "function"
                ? preferencesStore.getMapMaximizedPreference()
                : false;
            if (this.mapMaximized) {
                this.updateMapMaximizedOffset();
                document.body.classList.add("map-fullscreen-active");
            }

            this.resizeHandler = () => {
                if (this.mapMaximized) {
                    this.updateMapMaximizedOffset();
                }

                this.ensureMapSize();
            };
            window.addEventListener("resize", this.resizeHandler);

            window.requestAnimationFrame(() => {
                this.initializeMap();
                this.ensureMapSize();
                this.updateInputGeometryPreview(false);
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
            if (!this.mapThemeController) {
                return;
            }

            this.mapThemeController.ensureMapSize();
        },

        updateMapMaximizedOffset() {
            const navbar = document.querySelector("header .navbar");
            this.maximizedTopOffset = navbar ? Math.max(0, Math.ceil(navbar.getBoundingClientRect().bottom)) : 0;
        },

        toggleMapMaximized() {
            this.mapMaximized = !this.mapMaximized;
            if (preferencesStore && typeof preferencesStore.setMapMaximizedPreference === "function") {
                preferencesStore.setMapMaximizedPreference(this.mapMaximized);
            }

            if (this.mapMaximized) {
                this.updateMapMaximizedOffset();
                document.body.classList.add("map-fullscreen-active");
            }
            else {
                document.body.classList.remove("map-fullscreen-active");
            }

            this.$nextTick(() => {
                this.ensureMapSize();
            });
        },

        useCartoBasemap() {
            if (!this.mapThemeController) {
                return;
            }

            this.mapThemeController.useCartoBasemap();
        },

        updateBasemapForTheme() {
            this.useCartoBasemap();
        },

        formatDuration(milliseconds) {
            return tools.formatDuration(milliseconds);
        },

        formatBytes(bytes) {
            return tools.formatBytes(bytes);
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
                const bounds = tools.decodeGeohashBounds(geohash);
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
            return tools.toStatusCode(status);
        },

        getStatusLabel(statusCode, fallback) {
            return tools.getStatusLabel(statusCode, fallback);
        },

        isSubmissionLocked() {
            return tools.isSubmissionLocked(this.jobId, this.status);
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
            tools.notifySuccess("Polyhash complete", "Your polyhash job finished successfully.");
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

            document.body.classList.remove("map-fullscreen-active");

            if (this.resizeHandler) {
                window.removeEventListener("resize", this.resizeHandler);
                this.resizeHandler = null;
            }

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
