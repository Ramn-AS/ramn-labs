(function () {
    const statusCodes = Object.freeze({
        queued: 0,
        running: 1,
        completed: 2,
        failed: 3,
        timedOut: 4,
        dropped: 5
    });

    function toStatusCode(status) {
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
    }

    function getStatusLabel(statusCode, fallback) {
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
    }

    function isSubmissionLocked(jobId, status) {
        if (!jobId) {
            return false;
        }

        const statusCode = toStatusCode(status);
        return statusCode === statusCodes.queued || statusCode === statusCodes.running;
    }

    function formatDuration(milliseconds) {
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
    }

    function formatBytes(bytes) {
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
    }

    function isConnectivityError(err) {
        if (!err || typeof err !== "object") {
            return false;
        }

        return err.name === "TypeError";
    }

    function notifyBackendConnectionError() {
        if (window.appNotifications && typeof window.appNotifications.backendConnectionError === "function") {
            window.appNotifications.backendConnectionError();
        }
    }

    function notifySuccess(title, message, delay) {
        if (window.appNotifications && typeof window.appNotifications.success === "function") {
            window.appNotifications.success(title, message, delay);
        }
    }

    function createPollingController(options) {
        const getDelaySeconds = options && typeof options.getDelaySeconds === "function"
            ? options.getDelaySeconds
            : () => 2;
        const poll = options && typeof options.poll === "function"
            ? options.poll
            : () => { };

        let timerId = null;

        function runPoll() {
            poll();
        }

        return {
            start() {
                this.stop();
                const delaySeconds = Number(getDelaySeconds()) || 2;
                timerId = window.setInterval(runPoll, Math.max(1, delaySeconds) * 1000);
                runPoll();
            },

            stop() {
                if (timerId) {
                    window.clearInterval(timerId);
                    timerId = null;
                }
            }
        };
    }

    function getAppliedTheme() {
        const value = document.documentElement.getAttribute("data-bs-theme");
        return value === "dark" ? "dark" : "light";
    }

    function createCartoLayer(theme) {
        const styleName = theme === "dark" ? "dark_all" : "light_all";
        return L.tileLayer(`https://a.basemaps.cartocdn.com/${styleName}/{z}/{x}/{y}.png`, {
            attribution: '&copy; <a href="https://carto.com">CARTO</a>, &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>',
            maxZoom: 20
        });
    }

    function createOsmLayer() {
        return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>',
            maxZoom: 20
        });
    }

    function createLeafletThemeController(map) {
        let baseLayer = null;
        let themeObserver = null;
        let resizeHandler = null;

        function ensureMapSize() {
            if (map) {
                map.invalidateSize();
            }
        }

        function swapBaseLayer(nextLayer) {
            if (!map) {
                return;
            }

            if (baseLayer) {
                map.removeLayer(baseLayer);
            }

            baseLayer = nextLayer;
            baseLayer.addTo(map);
            ensureMapSize();
        }

        return {
            init() {
                if (!map) {
                    return;
                }

                swapBaseLayer(createCartoLayer(getAppliedTheme()));

                themeObserver = new MutationObserver(() => {
                    this.useCartoBasemap();
                });

                themeObserver.observe(document.documentElement, {
                    attributes: true,
                    attributeFilter: ["data-bs-theme"]
                });

                resizeHandler = () => {
                    ensureMapSize();
                };

                window.addEventListener("resize", resizeHandler);
            },

            ensureMapSize,

            useCartoBasemap() {
                if (!map) {
                    return;
                }

                swapBaseLayer(createCartoLayer(getAppliedTheme()));
            },

            useOsmBasemap() {
                if (!map) {
                    return;
                }

                swapBaseLayer(createOsmLayer());
            },

            dispose() {
                if (resizeHandler) {
                    window.removeEventListener("resize", resizeHandler);
                    resizeHandler = null;
                }

                if (themeObserver) {
                    themeObserver.disconnect();
                    themeObserver = null;
                }
            }
        };
    }

    window.ramnLabsTools = {
        statusCodes,
        toStatusCode,
        getStatusLabel,
        isSubmissionLocked,
        formatDuration,
        formatBytes,
        isConnectivityError,
        notifyBackendConnectionError,
        notifySuccess,
        createPollingController,
        createLeafletThemeController
    };
})();
