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

    function notifyError(title, message, delay) {
        if (window.appNotifications && typeof window.appNotifications.error === "function") {
            window.appNotifications.error(title, message, delay);
        }
    }

    function debounce(callback, waitMilliseconds) {
        if (typeof callback !== "function") {
            return () => { };
        }

        const wait = Number.isFinite(waitMilliseconds) ? Math.max(0, waitMilliseconds) : 150;
        let timeoutId = null;

        return (...args) => {
            if (timeoutId) {
                window.clearTimeout(timeoutId);
            }

            timeoutId = window.setTimeout(() => {
                timeoutId = null;
                callback(...args);
            }, wait);
        };
    }

    const geohashBase32 = "0123456789bcdefghjkmnpqrstuvwxyz";
    const geohashBits = [16, 8, 4, 2, 1];

    function normalizeLongitude(longitude) {
        let value = longitude;
        while (value < -180) {
            value += 360;
        }
        while (value > 180) {
            value -= 360;
        }
        if (value === 180) {
            return 179.999999;
        }
        return value;
    }

    function encodeGeohash(latitude, longitude, precision) {
        const targetLength = Number.isInteger(precision) ? precision : 6;
        if (targetLength < 1 || targetLength > 12) {
            return null;
        }

        let lat = Math.min(89.999999, Math.max(-89.999999, Number(latitude)));
        let lon = normalizeLongitude(Number(longitude));
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            return null;
        }

        let evenBit = true;
        let bit = 0;
        let characterValue = 0;
        let geohash = "";
        let latRange = [-90.0, 90.0];
        let lonRange = [-180.0, 180.0];

        while (geohash.length < targetLength) {
            if (evenBit) {
                const midpoint = (lonRange[0] + lonRange[1]) / 2;
                if (lon >= midpoint) {
                    characterValue |= geohashBits[bit];
                    lonRange[0] = midpoint;
                }
                else {
                    lonRange[1] = midpoint;
                }
            }
            else {
                const midpoint = (latRange[0] + latRange[1]) / 2;
                if (lat >= midpoint) {
                    characterValue |= geohashBits[bit];
                    latRange[0] = midpoint;
                }
                else {
                    latRange[1] = midpoint;
                }
            }

            evenBit = !evenBit;

            if (bit < 4) {
                bit += 1;
            }
            else {
                geohash += geohashBase32[characterValue];
                bit = 0;
                characterValue = 0;
            }
        }

        return geohash;
    }

    function decodeGeohashBounds(geohash) {
        if (typeof geohash !== "string" || geohash.trim().length === 0) {
            return null;
        }

        let evenBit = true;
        const latRange = [-90.0, 90.0];
        const lonRange = [-180.0, 180.0];

        for (const character of geohash.trim().toLowerCase()) {
            const characterIndex = geohashBase32.indexOf(character);
            if (characterIndex < 0) {
                return null;
            }

            for (const bit of geohashBits) {
                if (evenBit) {
                    const midpoint = (lonRange[0] + lonRange[1]) / 2;
                    if ((characterIndex & bit) !== 0) {
                        lonRange[0] = midpoint;
                    }
                    else {
                        lonRange[1] = midpoint;
                    }
                }
                else {
                    const midpoint = (latRange[0] + latRange[1]) / 2;
                    if ((characterIndex & bit) !== 0) {
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

    function getGeohashCellSpan(precision) {
        const sample = encodeGeohash(0, 0, precision);
        const bounds = decodeGeohashBounds(sample);
        if (!bounds) {
            return null;
        }

        return {
            latSpan: bounds.maxLat - bounds.minLat,
            lonSpan: bounds.maxLon - bounds.minLon
        };
    }

    function enumerateGeohashesInBounds(rawBounds, precision, maxCells) {
        const bounds = rawBounds || {};
        const south = Math.max(-90, Number(bounds.south));
        const north = Math.min(90, Number(bounds.north));
        const west = Number(bounds.west);
        const east = Number(bounds.east);
        if (!Number.isFinite(south) || !Number.isFinite(north) || !Number.isFinite(west) || !Number.isFinite(east)) {
            return { geohashes: [], capped: false };
        }

        const effectivePrecision = Number.isInteger(precision) ? precision : 5;
        const span = getGeohashCellSpan(effectivePrecision);
        if (!span || span.latSpan <= 0 || span.lonSpan <= 0) {
            return { geohashes: [], capped: false };
        }

        const set = new Set();
        const cap = Number.isInteger(maxCells) ? Math.max(1, maxCells) : 1500;

        function enumerateRange(rangeWest, rangeEast) {
            const adjustedWest = normalizeLongitude(rangeWest);
            const adjustedEast = normalizeLongitude(rangeEast);
            let lonStart = adjustedWest;
            let lonEnd = adjustedEast;
            if (lonEnd < lonStart) {
                lonEnd += 360;
            }

            const epsilonLat = span.latSpan / 10;
            const epsilonLon = span.lonSpan / 10;
            const latStartAligned = (Math.floor((south + 90) / span.latSpan) * span.latSpan) - 90 - span.latSpan;
            const latEndAligned = (Math.ceil((north + 90) / span.latSpan) * span.latSpan) - 90 + span.latSpan;
            const lonStartAligned = (Math.floor((lonStart + 180) / span.lonSpan) * span.lonSpan) - 180 - span.lonSpan;
            const lonEndAligned = (Math.ceil((lonEnd + 180) / span.lonSpan) * span.lonSpan) - 180 + span.lonSpan;

            for (let lat = latStartAligned; lat <= (latEndAligned + epsilonLat); lat += span.latSpan) {
                const centerLat = Math.min(89.999999, Math.max(-89.999999, lat + (span.latSpan / 2)));

                for (let lon = lonStartAligned; lon <= (lonEndAligned + epsilonLon); lon += span.lonSpan) {
                    const centerLon = normalizeLongitude(lon + (span.lonSpan / 2));
                    const geohash = encodeGeohash(centerLat, centerLon, effectivePrecision);
                    if (!geohash) {
                        continue;
                    }

                    const decoded = decodeGeohashBounds(geohash);
                    if (!decoded) {
                        continue;
                    }

                    const intersectsLatitude = decoded.maxLat >= (south - epsilonLat) && decoded.minLat <= (north + epsilonLat);
                    const intersectsLongitude = decoded.maxLon >= (lonStart - epsilonLon) && decoded.minLon <= (lonEnd + epsilonLon);
                    if (!intersectsLatitude || !intersectsLongitude) {
                        continue;
                    }

                    set.add(geohash);
                    if (set.size >= cap) {
                        return true;
                    }
                }
            }

            return false;
        }

        let capped = false;
        if (west <= east) {
            capped = enumerateRange(west, east);
        }
        else {
            capped = enumerateRange(west, 180) || enumerateRange(-180, east);
        }

        const geohashes = [...set].sort();
        return { geohashes, capped };
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
            maxNativeZoom: 20,
            maxZoom: 24
        });
    }

    function createOsmLayer() {
        return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>',
            maxNativeZoom: 20,
            maxZoom: 24
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
        notifyError,
        debounce,
        createPollingController,
        createLeafletThemeController,
        encodeGeohash,
        decodeGeohashBounds,
        enumerateGeohashesInBounds
    };
})();
