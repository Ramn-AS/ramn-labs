document.addEventListener("alpine:init", () => {
    const preferencesStore = window.preferencesStore;
    const maxRenderedSegments = 800;
    const specPreferenceKey = "ramnlabs.laser-beam.spec.v1";
    const mapViewPreferenceKey = "ramnlabs.laser-beam.map-view.v1";
    const safetyThresholdsWm2 = Object.freeze({
        nohdMpe: 25.4,
        szed: 1.0,
        czed: 0.05,
        lfzed: 0.0005
    });
    const visualCorrectionFactorTable = Object.freeze([
        { wavelengthNm: 400, vcf: 4.0e-4 },
        { wavelengthNm: 410, vcf: 1.2e-3 },
        { wavelengthNm: 420, vcf: 4.0e-3 },
        { wavelengthNm: 430, vcf: 1.16e-2 },
        { wavelengthNm: 440, vcf: 2.30e-2 },
        { wavelengthNm: 450, vcf: 3.80e-2 },
        { wavelengthNm: 460, vcf: 5.99e-2 },
        { wavelengthNm: 470, vcf: 9.09e-2 },
        { wavelengthNm: 480, vcf: 1.391e-1 },
        { wavelengthNm: 490, vcf: 2.079e-1 },
        { wavelengthNm: 500, vcf: 3.226e-1 },
        { wavelengthNm: 510, vcf: 5.025e-1 },
        { wavelengthNm: 520, vcf: 7.092e-1 },
        { wavelengthNm: 530, vcf: 8.621e-1 },
        { wavelengthNm: 540, vcf: 9.524e-1 },
        { wavelengthNm: 550, vcf: 9.901e-1 },
        { wavelengthNm: 555, vcf: 1.0 },
        { wavelengthNm: 560, vcf: 9.901e-1 },
        { wavelengthNm: 570, vcf: 9.524e-1 },
        { wavelengthNm: 580, vcf: 8.696e-1 },
        { wavelengthNm: 590, vcf: 7.576e-1 },
        { wavelengthNm: 600, vcf: 6.329e-1 },
        { wavelengthNm: 610, vcf: 5.025e-1 },
        { wavelengthNm: 620, vcf: 3.817e-1 },
        { wavelengthNm: 630, vcf: 2.653e-1 },
        { wavelengthNm: 640, vcf: 1.751e-1 },
        { wavelengthNm: 650, vcf: 1.070e-1 },
        { wavelengthNm: 660, vcf: 6.10e-2 },
        { wavelengthNm: 670, vcf: 3.21e-2 },
        { wavelengthNm: 680, vcf: 1.70e-2 },
        { wavelengthNm: 690, vcf: 8.2e-3 },
        { wavelengthNm: 700, vcf: 4.1e-3 }
    ]);

    const defaultSpec = Object.freeze({
        originLat: 63.4305,
        originLon: 10.3951,
        targetLat: 63.4432,
        targetLon: 10.4318,
        divergenceMrad: 1.0,
        apertureMm: 6,
        beamQualityM2: 1.0,
        visualExaggeration: 1,
        segmentsPer100m: 10,
        gradientGamma: 1.0,
        wavelengthNm: 532,
        enableAtmosphericEffects: true,
        atmosphericLossDbPerKmAt550: 0.2,
        atmosphericWavelengthExponent: 1.3,
        visualSaturationWm2: 1,
        powerW: 20,
        cutoffWm2: 0.001,
        showSafetyOverlays: true
    });

    function cloneSpec(spec) {
        return JSON.parse(JSON.stringify(spec));
    }

    function clamp(value, min, max) {
        if (!Number.isFinite(value)) {
            return min;
        }

        return Math.min(max, Math.max(min, value));
    }

    function formatNumber(value, decimals) {
        if (!Number.isFinite(value)) {
            return "-";
        }

        return Number(value).toLocaleString(undefined, {
            maximumFractionDigits: decimals,
            minimumFractionDigits: decimals > 0 && Math.abs(value) < 10 ? Math.min(2, decimals) : 0
        });
    }

    function radToDeg(rad) {
        return rad * (180 / Math.PI);
    }

    function degToRad(deg) {
        return (Number(deg) || 0) * (Math.PI / 180);
    }

    function normalizeDegrees(deg) {
        return ((deg % 360) + 360) % 360;
    }

    function offsetPoint(x, y, bearingRad, distanceM) {
        return {
            x: x + (Math.sin(bearingRad) * distanceM),
            y: y + (Math.cos(bearingRad) * distanceM)
        };
    }

    function channelToHex(value) {
        const clamped = Math.round(clamp(value, 0, 255));
        return clamped.toString(16).padStart(2, "0");
    }

    function rgbToHex(r, g, b) {
        return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
    }

    function hexToRgb(hex) {
        if (typeof hex !== "string") {
            return null;
        }

        const clean = hex.trim().replace("#", "");
        if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
            return null;
        }

        return {
            r: Number.parseInt(clean.slice(0, 2), 16),
            g: Number.parseInt(clean.slice(2, 4), 16),
            b: Number.parseInt(clean.slice(4, 6), 16)
        };
    }

    function blendHexColors(fromHex, toHex, amount) {
        const from = hexToRgb(fromHex);
        const to = hexToRgb(toHex);
        if (!from || !to) {
            return fromHex || toHex || "#ffffff";
        }

        const t = clamp(Number(amount), 0, 1);
        return rgbToHex(
            from.r + ((to.r - from.r) * t),
            from.g + ((to.g - from.g) * t),
            from.b + ((to.b - from.b) * t)
        );
    }

    function wavelengthToVisibleHex(wavelengthNm) {
        const wavelength = Number(wavelengthNm);
        if (!Number.isFinite(wavelength) || wavelength < 380 || wavelength > 780) {
            return null;
        }

        let red = 0;
        let green = 0;
        let blue = 0;
        if (wavelength < 440) {
            red = -(wavelength - 440) / (440 - 380);
            blue = 1;
        }
        else if (wavelength < 490) {
            green = (wavelength - 440) / (490 - 440);
            blue = 1;
        }
        else if (wavelength < 510) {
            green = 1;
            blue = -(wavelength - 510) / (510 - 490);
        }
        else if (wavelength < 580) {
            red = (wavelength - 510) / (580 - 510);
            green = 1;
        }
        else if (wavelength < 645) {
            red = 1;
            green = -(wavelength - 645) / (645 - 580);
        }
        else {
            red = 1;
        }

        let factor = 1;
        if (wavelength < 420) {
            factor = 0.3 + (0.7 * (wavelength - 380) / (420 - 380));
        }
        else if (wavelength > 700) {
            factor = 0.3 + (0.7 * (780 - wavelength) / (780 - 700));
        }

        const gamma = 0.8;
        const redByte = 255 * Math.pow(red * factor, gamma);
        const greenByte = 255 * Math.pow(green * factor, gamma);
        const blueByte = 255 * Math.pow(blue * factor, gamma);
        return rgbToHex(redByte, greenByte, blueByte);
    }

    function createTargetCrosshairDataUri() {
        const stroke = "#ffffff";
        const svg = [
            "<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'>",
            `<circle cx='20' cy='20' r='11' fill='none' stroke='${stroke}' stroke-width='2'/>`,
            `<line x1='20' y1='2' x2='20' y2='10' stroke='${stroke}' stroke-width='2.4' stroke-linecap='round'/>`,
            `<line x1='20' y1='30' x2='20' y2='38' stroke='${stroke}' stroke-width='2.4' stroke-linecap='round'/>`,
            `<line x1='2' y1='20' x2='10' y2='20' stroke='${stroke}' stroke-width='2.4' stroke-linecap='round'/>`,
            `<line x1='30' y1='20' x2='38' y2='20' stroke='${stroke}' stroke-width='2.4' stroke-linecap='round'/>`,
            `<circle cx='20' cy='20' r='2.2' fill='${stroke}'/>`,
            "</svg>"
        ].join("");

        return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }

    Alpine.data("laserBeamTool", () => ({
        spec: cloneSpec(defaultSpec),
        calc: {
            cutoffRangeM: 0,
            endDiameterM: 0,
            targetDistanceM: 0,
            targetDiameterM: 0,
            targetIrradianceWm2: 0,
            targetTransmissionFraction: 1,
            bearingDeg: 0,
            bearingRad: 0,
            diffractionFloorMrad: 0,
            effectiveDivergenceMrad: 0,
            atmosphericLossDbPerKmAtWavelength: 0,
            renderedSegments: 0,
            safety: {
                nohdM: 0,
                ed50M: 0,
                szedM: null,
                czedM: null,
                lfzedM: null,
                visualCorrectionFactor: null,
                statusKey: "outside",
                statusLabel: "Outside all safety zones",
                statusClass: "text-success"
            }
        },
        map: null,
        darkBaseLayer: null,
        beamLayer: null,
        safetyLayer: null,
        markerLayer: null,
        originFeature: null,
        targetFeature: null,
        dragControl: null,
        mapMaximized: true,
        maximizedTopOffset: 0,
        resizeHandler: null,
        themeObserver: null,
        errorHandler: null,
        rejectionHandler: null,
        beamColorHex: "#22d3ee",
        beamColorDescription: "Non-visible wavelength (using fallback beam color)",
        targetCrosshairDataUri: createTargetCrosshairDataUri(),
        statusMessage: null,
        statusError: false,
        hasSavedMapView: false,

        init() {
            this.loadSpecPreference();
            this.mapMaximized = true;
            this.updateMapMaximizedOffset();
            document.body.classList.add("map-fullscreen-active");

            this.resizeHandler = () => {
                if (this.mapMaximized) {
                    this.updateMapMaximizedOffset();
                }

                this.ensureMapSize();
            };
            window.addEventListener("resize", this.resizeHandler);

            this.errorHandler = (event) => {
                this.setStatus(`Runtime error: ${event.message || "Unknown error."}`, true);
            };
            window.addEventListener("error", this.errorHandler);

            this.rejectionHandler = (event) => {
                this.setStatus(`Unhandled rejection: ${String(event.reason || "Unknown error.")}`, true);
            };
            window.addEventListener("unhandledrejection", this.rejectionHandler);

            window.requestAnimationFrame(() => {
                try {
                    if (!this.initializeMap()) {
                        return;
                    }

                    this.refresh(true);
                    if (!this.hasSavedMapView) {
                        this.fitToPoints();
                    }
                    this.ensureMapSize();
                    //this.runSelfTests();
                }
                catch (error) {
                    this.setStatus(error && error.message ? error.message : "Failed to initialize tool.", true);
                }
            });
        },

        destroy() {
            document.body.classList.remove("map-fullscreen-active");

            if (this.resizeHandler) {
                window.removeEventListener("resize", this.resizeHandler);
                this.resizeHandler = null;
            }

            if (this.themeObserver) {
                this.themeObserver.disconnect();
                this.themeObserver = null;
            }

            if (this.errorHandler) {
                window.removeEventListener("error", this.errorHandler);
                this.errorHandler = null;
            }

            if (this.rejectionHandler) {
                window.removeEventListener("unhandledrejection", this.rejectionHandler);
                this.rejectionHandler = null;
            }

            if (this.dragControl && this.map) {
                this.dragControl.deactivate();
                this.map.removeControl(this.dragControl);
            }

            if (this.map) {
                this.map.destroy();
                this.map = null;
            }
        },

        loadSpecPreference() {
            if (!preferencesStore || typeof preferencesStore.getPreference !== "function") {
                return;
            }

            const saved = preferencesStore.getPreference(specPreferenceKey, null);
            if (!saved || typeof saved !== "object") {
                return;
            }

            this.spec = {
                ...cloneSpec(defaultSpec),
                ...saved
            };
            this.normalizeSpec();
        },

        persistSpecPreference() {
            if (!preferencesStore || typeof preferencesStore.setPreference !== "function") {
                return;
            }

            preferencesStore.setPreference(specPreferenceKey, this.spec);
        },

        loadMapViewPreference() {
            this.hasSavedMapView = false;
            if (!preferencesStore || typeof preferencesStore.getPreference !== "function") {
                return null;
            }

            const saved = preferencesStore.getPreference(mapViewPreferenceKey, null);
            if (!saved || typeof saved !== "object") {
                return null;
            }

            const lon = clamp(Number(saved.lon), -180, 180);
            const lat = clamp(Number(saved.lat), -85, 85);
            const zoom = clamp(Number(saved.zoom), 0, 19);

            if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(zoom)) {
                return null;
            }

            this.hasSavedMapView = true;
            return { lon, lat, zoom };
        },

        persistMapViewPreference() {
            if (!this.map || !preferencesStore || typeof preferencesStore.setPreference !== "function") {
                return;
            }

            const center = this.map.getCenter();
            const zoom = this.map.getZoom();
            if (!center || !Number.isFinite(zoom)) {
                return;
            }

            const centerLonLat = this.mercatorToLonLat(center.lon, center.lat);
            preferencesStore.setPreference(mapViewPreferenceKey, {
                lon: Number(centerLonLat.lon.toFixed(6)),
                lat: Number(centerLonLat.lat.toFixed(6)),
                zoom: Number(zoom)
            });
        },

        initializeMap() {
            if (!window.OpenLayers) {
                this.setStatus("OpenLayers failed to load.", true);
                return false;
            }

            OpenLayers.ImgPath = "https://cdnjs.cloudflare.com/ajax/libs/openlayers/2.13.1/img/";

            this.map = new OpenLayers.Map(this.$refs.map, {
                projection: new OpenLayers.Projection("EPSG:3857"),
                displayProjection: new OpenLayers.Projection("EPSG:4326"),
                units: "m",
                controls: [
                    new OpenLayers.Control.Navigation(),
                    new OpenLayers.Control.ZoomPanel(),
                    new OpenLayers.Control.Attribution()
                ]
            });

            this.darkBaseLayer = this.createCartoLayer("dark_all", "CARTO Dark Matter");
            this.beamLayer = new OpenLayers.Layer.Vector("Laser irradiance field", {
                rendererOptions: { zIndexing: true }
            });
            this.safetyLayer = new OpenLayers.Layer.Vector("Laser safety overlays", {
                rendererOptions: { zIndexing: true }
            });
            this.markerLayer = new OpenLayers.Layer.Vector("Origin and target markers", {
                rendererOptions: { zIndexing: true }
            });

            this.map.addLayers([this.darkBaseLayer, this.beamLayer, this.safetyLayer, this.markerLayer]);
            this.applyThemeBasemap();

            const savedMapView = this.loadMapViewPreference();
            if (savedMapView) {
                const savedCenter = this.lonLatToMercator(savedMapView.lon, savedMapView.lat);
                this.map.setCenter(savedCenter, savedMapView.zoom);
            }
            else {
                const center = this.lonLatToMercator(this.spec.originLon, this.spec.originLat);
                this.map.setCenter(center, 14);
            }

            this.dragControl = new OpenLayers.Control.DragFeature(this.markerLayer, {
                onDrag: (feature) => {
                    this.updatePointFromFeature(feature);
                    this.refreshDuringDrag(feature);
                },
                onComplete: (feature) => {
                    this.updatePointFromFeature(feature);
                    this.persistSpecPreference();
                    this.refresh(false);
                }
            });

            this.map.addControl(this.dragControl);
            this.dragControl.activate();

            this.themeObserver = new MutationObserver(() => {
                this.applyThemeBasemap();
            });

            this.themeObserver.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ["data-bs-theme"]
            });

            this.map.events.register("moveend", this, () => {
                this.persistMapViewPreference();
            });

            return true;
        },

        createCartoLayer(styleName, layerName) {
            return new OpenLayers.Layer.XYZ(
                layerName,
                [
                    `https://a.basemaps.cartocdn.com/${styleName}/${"${z}"}/${"${x}"}/${"${y}"}.png`,
                    `https://b.basemaps.cartocdn.com/${styleName}/${"${z}"}/${"${x}"}/${"${y}"}.png`,
                    `https://c.basemaps.cartocdn.com/${styleName}/${"${z}"}/${"${x}"}/${"${y}"}.png`,
                    `https://d.basemaps.cartocdn.com/${styleName}/${"${z}"}/${"${x}"}/${"${y}"}.png`
                ],
                {
                    sphericalMercator: true,
                    wrapDateLine: true,
                    numZoomLevels: 20,
                    attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
                }
            );
        },

        applyThemeBasemap() {
            if (!this.map || !this.darkBaseLayer) {
                return;
            }

            if (this.map.baseLayer !== this.darkBaseLayer) {
                this.map.setBaseLayer(this.darkBaseLayer);
            }

            this.updateTargetCrosshairGraphic();
        },

        toggleMapMaximized() {
            this.mapMaximized = true;
            this.updateMapMaximizedOffset();
            document.body.classList.add("map-fullscreen-active");

            this.$nextTick(() => {
                this.ensureMapSize();
            });
        },

        updateMapMaximizedOffset() {
            const navbar = document.querySelector("header .navbar");
            this.maximizedTopOffset = navbar ? Math.max(0, Math.ceil(navbar.getBoundingClientRect().bottom)) : 0;
        },

        ensureMapSize() {
            if (!this.map) {
                return;
            }

            this.map.updateSize();
        },

        refreshFromInputs(recreateMarkers) {
            this.normalizeSpec();
            this.persistSpecPreference();
            this.refresh(recreateMarkers === true);
        },

        resetDemo() {
            this.spec = cloneSpec(defaultSpec);
            this.persistSpecPreference();
            this.refresh(true);
            this.centerOnOrigin();
        },

        centerOnOrigin() {
            if (!this.map) {
                return;
            }

            const origin = this.lonLatToMercator(this.spec.originLon, this.spec.originLat);
            this.map.setCenter(origin, this.map.getZoom());
            this.persistMapViewPreference();
        },

        fitToPoints() {
            if (!this.map) {
                return;
            }

            const origin = this.lonLatToMercator(this.spec.originLon, this.spec.originLat);
            const target = this.lonLatToMercator(this.spec.targetLon, this.spec.targetLat);
            const bounds = new OpenLayers.Bounds();
            bounds.extend(origin);
            bounds.extend(target);

            const paddedBounds = bounds.scale(1.6);
            this.map.zoomToExtent(paddedBounds, true);

            const currentZoom = this.map.getZoom();
            if (Number.isFinite(currentZoom) && currentZoom > 18) {
                this.map.zoomTo(18);
            }

            this.persistMapViewPreference();
        },

        refresh(recreateMarkers) {
            if (!this.map) {
                return;
            }

            this.normalizeSpec();
            this.calculate();
            this.updateBeamColor();
            this.drawBeam();
            this.drawSafetyOverlays();
            this.updateMarkerStyles();

            if (recreateMarkers || !this.originFeature || !this.targetFeature) {
                this.drawMarkers();
            }
            else {
                this.moveMarkers();
            }
        },

        refreshDuringDrag(activeFeature) {
            if (!this.map) {
                return;
            }

            this.normalizeSpec();
            this.calculate();
            this.updateBeamColor();
            this.drawBeam();
            this.drawSafetyOverlays();
            this.updateMarkerStyles();

            if (activeFeature !== this.originFeature) {
                this.moveFeatureToLonLat(this.originFeature, this.spec.originLon, this.spec.originLat);
            }

            if (activeFeature !== this.targetFeature) {
                this.moveFeatureToLonLat(this.targetFeature, this.spec.targetLon, this.spec.targetLat);
            }
        },

        normalizeSpec() {
            this.spec.originLat = clamp(Number(this.spec.originLat), -85, 85);
            this.spec.originLon = clamp(Number(this.spec.originLon), -180, 180);
            this.spec.targetLat = clamp(Number(this.spec.targetLat), -85, 85);
            this.spec.targetLon = clamp(Number(this.spec.targetLon), -180, 180);
            this.spec.divergenceMrad = clamp(Number(this.spec.divergenceMrad), 0.001, 1000);
            this.spec.apertureMm = clamp(Number(this.spec.apertureMm), 0, 10000);
            this.spec.beamQualityM2 = clamp(Number(this.spec.beamQualityM2), 1, 50);
            this.spec.visualExaggeration = clamp(Number(this.spec.visualExaggeration), 1, 200);
            this.spec.segmentsPer100m = clamp(Number(this.spec.segmentsPer100m), 0.2, 20);
            this.spec.gradientGamma = clamp(Number(this.spec.gradientGamma), 0.15, 1.5);
            this.spec.wavelengthNm = clamp(Number(this.spec.wavelengthNm), 200, 1550);
            this.spec.enableAtmosphericEffects = this.spec.enableAtmosphericEffects !== false;
            this.spec.atmosphericLossDbPerKmAt550 = clamp(Number(this.spec.atmosphericLossDbPerKmAt550), 0, 1000);
            this.spec.atmosphericWavelengthExponent = clamp(Number(this.spec.atmosphericWavelengthExponent), 0, 8);
            this.spec.visualSaturationWm2 = clamp(Number(this.spec.visualSaturationWm2), 0.001, 1000000000);
            this.spec.powerW = clamp(Number(this.spec.powerW), 0.000001, 1000000);
            this.spec.cutoffWm2 = clamp(Number(this.spec.cutoffWm2), 0.000001, 1000000000);
            this.spec.showSafetyOverlays = this.spec.showSafetyOverlays !== false;
        },

        calculate() {
            const origin = this.lonLatToMercator(this.spec.originLon, this.spec.originLat);
            const target = this.lonLatToMercator(this.spec.targetLon, this.spec.targetLat);

            const dx = target.lon - origin.lon;
            const dy = target.lat - origin.lat;
            const targetDistanceM = Math.max(0.001, Math.sqrt((dx * dx) + (dy * dy)));
            const bearingRad = Math.atan2(dx, dy);
            const bearingDeg = normalizeDegrees(radToDeg(bearingRad));
            const cutoffRangeM = this.calculateCutoffRange();
            const diffractionFloorRad = this.getDiffractionLimitedFullAngleRad();
            const effectiveDivergenceRad = this.getEffectiveFullAngleDivergenceRad();
            const targetTransmissionFraction = this.getAtmosphericTransmission(targetDistanceM);
            const atmosphericLossDbPerKmAtWavelength = this.getAtmosphericLossDbPerKmAtWavelength();
            const safety = this.calculateSafetyDistances(targetDistanceM);

            this.calc = {
                cutoffRangeM,
                endDiameterM: this.beamDiameter(cutoffRangeM),
                targetDistanceM,
                targetDiameterM: this.beamDiameter(targetDistanceM),
                targetIrradianceWm2: this.irradiance(targetDistanceM),
                targetTransmissionFraction,
                bearingDeg,
                bearingRad,
                diffractionFloorMrad: diffractionFloorRad * 1000,
                effectiveDivergenceMrad: effectiveDivergenceRad * 1000,
                atmosphericLossDbPerKmAtWavelength,
                renderedSegments: this.segmentCountForRange(cutoffRangeM),
                safety
            };
        },

        calculateSafetyDistances(targetDistanceM) {
            const nohdM = this.calculateRangeForEffectiveIrradianceThreshold(safetyThresholdsWm2.nohdMpe, 1);
            const ed50M = nohdM / 3;
            const visualCorrectionFactor = this.getVisualCorrectionFactor();

            let szedM = null;
            let czedM = null;
            let lfzedM = null;

            if (visualCorrectionFactor && visualCorrectionFactor > 0) {
                szedM = this.calculateRangeForEffectiveIrradianceThreshold(safetyThresholdsWm2.szed, visualCorrectionFactor);
                czedM = this.calculateRangeForEffectiveIrradianceThreshold(safetyThresholdsWm2.czed, visualCorrectionFactor);
                lfzedM = this.calculateRangeForEffectiveIrradianceThreshold(safetyThresholdsWm2.lfzed, visualCorrectionFactor);

                // Conservative rule from FAA/LPS usage: visual distances should not be shorter than NOHD.
                szedM = Math.max(szedM, nohdM);
                czedM = Math.max(czedM, nohdM);
                lfzedM = Math.max(lfzedM, nohdM);
            }

            const status = this.getTargetSafetyStatus(targetDistanceM, nohdM, szedM, czedM, lfzedM);

            return {
                nohdM,
                ed50M,
                szedM,
                czedM,
                lfzedM,
                visualCorrectionFactor,
                statusKey: status.key,
                statusLabel: status.label,
                statusClass: status.className
            };
        },

        calculateRangeForEffectiveIrradianceThreshold(thresholdWm2, correctionFactor) {
            const correctedThresholdWm2 = Math.max(0.000000001, Number(thresholdWm2) || 0);
            const vcf = clamp(Number(correctionFactor) || 0, 0.000000001, 1);
            const maxRangeM = 250000;

            const nearIrradiance = this.irradiance(0) * vcf;
            if (nearIrradiance <= correctedThresholdWm2) {
                return 0;
            }

            const farIrradiance = this.irradiance(maxRangeM) * vcf;
            if (farIrradiance > correctedThresholdWm2) {
                return maxRangeM;
            }

            let low = 0;
            let high = maxRangeM;
            for (let iteration = 0; iteration < 64; iteration += 1) {
                const mid = (low + high) / 2;
                const midIrradiance = this.irradiance(mid) * vcf;
                if (midIrradiance > correctedThresholdWm2) {
                    low = mid;
                }
                else {
                    high = mid;
                }
            }

            return high;
        },

        getVisualCorrectionFactor() {
            const wavelengthNm = Number(this.spec.wavelengthNm);
            if (!Number.isFinite(wavelengthNm) || wavelengthNm < 400 || wavelengthNm > 700) {
                return null;
            }

            if (wavelengthNm === 555) {
                return 1;
            }

            for (let index = 0; index < visualCorrectionFactorTable.length - 1; index += 1) {
                const left = visualCorrectionFactorTable[index];
                const right = visualCorrectionFactorTable[index + 1];

                if (wavelengthNm < left.wavelengthNm || wavelengthNm > right.wavelengthNm) {
                    continue;
                }

                if (wavelengthNm === left.wavelengthNm) {
                    return left.vcf;
                }

                if (wavelengthNm === right.wavelengthNm) {
                    return right.vcf;
                }

                const span = right.wavelengthNm - left.wavelengthNm;
                if (span <= 0) {
                    return left.vcf;
                }

                const ratio = (wavelengthNm - left.wavelengthNm) / span;
                return left.vcf + (ratio * (right.vcf - left.vcf));
            }

            return 1;
        },

        getTargetSafetyStatus(targetDistanceM, nohdM, szedM, czedM, lfzedM) {
            const distanceM = Math.max(0, targetDistanceM);
            if (distanceM < nohdM) {
                return { key: "eye", label: "Eye hazard (within NOHD)", className: "text-danger" };
            }

            if (Number.isFinite(szedM) && distanceM < szedM) {
                return { key: "flashblindness", label: "Flashblindness risk (within SZED)", className: "text-warning" };
            }

            if (Number.isFinite(czedM) && distanceM < czedM) {
                return { key: "glare", label: "Glare risk (within CZED)", className: "text-warning" };
            }

            if (Number.isFinite(lfzedM) && distanceM < lfzedM) {
                return { key: "distraction", label: "Distraction risk (within LFZED)", className: "text-info" };
            }

            return { key: "outside", label: "Outside all safety zones", className: "text-success" };
        },

        calculateCutoffRange() {
            const cutoff = Math.max(0.000001, this.spec.cutoffWm2);
            const maxRangeM = 250000;
            const lowRangeIrradiance = this.irradiance(0);
            if (lowRangeIrradiance <= cutoff) {
                return 0;
            }

            const highRangeIrradiance = this.irradiance(maxRangeM);
            if (highRangeIrradiance > cutoff) {
                return maxRangeM;
            }

            let low = 0;
            let high = maxRangeM;
            for (let iteration = 0; iteration < 64; iteration += 1) {
                const mid = (low + high) / 2;
                if (this.irradiance(mid) > cutoff) {
                    low = mid;
                }
                else {
                    high = mid;
                }
            }

            return high;
        },

        beamDiameter(rangeM) {
            const apertureM = Math.max(0, this.spec.apertureMm / 1000);
            const divergenceRad = this.getEffectiveFullAngleDivergenceRad();
            return apertureM + (Math.max(0, rangeM) * divergenceRad);
        },

        irradiance(rangeM) {
            const diameter = this.beamDiameter(rangeM);
            const radius = Math.max(0.000001, diameter / 2);
            const area = Math.PI * radius * radius;
            const power = Math.max(0, this.spec.powerW) * this.getAtmosphericTransmission(rangeM);
            return power / area;
        },

        getDiffractionLimitedFullAngleRad() {
            const wavelengthM = Math.max(200, this.spec.wavelengthNm) * 1e-9;
            const apertureM = Math.max(0.000001, this.spec.apertureMm / 1000);
            const beamQualityM2 = Math.max(1, this.spec.beamQualityM2);
            const diffractionFullAngleRad = 2.44 * beamQualityM2 * wavelengthM / apertureM;
            return clamp(diffractionFullAngleRad, 0.000000001, 2);
        },

        getEffectiveFullAngleDivergenceRad() {
            const userFullAngleRad = Math.max(0.000001, this.spec.divergenceMrad / 1000);
            return Math.max(userFullAngleRad, this.getDiffractionLimitedFullAngleRad());
        },

        getAtmosphericLossDbPerKmAtWavelength() {
            if (!this.spec.enableAtmosphericEffects) {
                return 0;
            }

            const baseLossDbPerKm = Math.max(0, this.spec.atmosphericLossDbPerKmAt550);
            const exponent = Math.max(0, this.spec.atmosphericWavelengthExponent);
            const wavelengthRatio = 550 / Math.max(200, this.spec.wavelengthNm);
            return baseLossDbPerKm * Math.pow(wavelengthRatio, exponent);
        },

        getAtmosphericTransmission(rangeM) {
            if (!this.spec.enableAtmosphericEffects) {
                return 1;
            }

            const rangeKm = Math.max(0, rangeM) / 1000;
            const lossDbPerKm = this.getAtmosphericLossDbPerKmAtWavelength();
            const totalLossDb = lossDbPerKm * rangeKm;
            return Math.pow(10, -totalLossDb / 10);
        },

        segmentCountForRange(rangeM) {
            const requested = Math.ceil((Math.max(1, rangeM) / 100) * this.spec.segmentsPer100m);
            return Math.round(clamp(requested, 2, maxRenderedSegments));
        },

        updateBeamColor() {
            const wavelengthNm = Number(this.spec.wavelengthNm);
            const white = "#ffffff";
            const uvVisibleEdgeNm = 380;
            const irVisibleEdgeNm = 780;
            const minWavelengthNm = 200;
            const maxWavelengthNm = 1550;

            const visibleColor = wavelengthToVisibleHex(this.spec.wavelengthNm);
            if (visibleColor) {
                this.beamColorHex = visibleColor;
                this.beamColorDescription = "Visible spectrum color";
                return;
            }

            if (wavelengthNm < uvVisibleEdgeNm) {
                const uvEdgeColor = wavelengthToVisibleHex(uvVisibleEdgeNm) || "#7f3fff";
                const fadeT = clamp((uvVisibleEdgeNm - wavelengthNm) / (uvVisibleEdgeNm - minWavelengthNm), 0, 1);
                this.beamColorHex = blendHexColors(uvEdgeColor, white, Math.pow(fadeT, 0.8));
                this.beamColorDescription = "Ultraviolet (false-color fade)";
                return;
            }

            const irEdgeColor = wavelengthToVisibleHex(irVisibleEdgeNm) || "#ff0000";
            const fadeT = clamp((wavelengthNm - irVisibleEdgeNm) / (maxWavelengthNm - irVisibleEdgeNm), 0, 1);
            this.beamColorHex = blendHexColors(irEdgeColor, white, Math.pow(fadeT, 0.8));
            this.beamColorDescription = "Infrared (false-color fade)";
        },

        drawBeam() {
            this.beamLayer.removeAllFeatures();

            const origin = this.lonLatToMercator(this.spec.originLon, this.spec.originLat);
            const bearing = this.calc.bearingRad;
            const rangeM = Math.max(1, this.calc.cutoffRangeM);
            const segmentCount = this.segmentCountForRange(rangeM);
            const features = [];
            const visualSaturationWm2 = Math.max(0.000001, this.spec.visualSaturationWm2);
            const gamma = Math.max(0.05, this.spec.gradientGamma);

            for (let index = 0; index < segmentCount; index += 1) {
                const t0 = index / segmentCount;
                const t1 = (index + 1) / segmentCount;
                const r0 = rangeM * t0;
                const r1 = rangeM * t1;
                const rm = rangeM * ((t0 + t1) / 2);

                const p0 = offsetPoint(origin.lon, origin.lat, bearing, r0);
                const p1 = offsetPoint(origin.lon, origin.lat, bearing, r1);

                const w0 = this.visualBeamHalfWidth(r0);
                const w1 = this.visualBeamHalfWidth(r1);

                const left0 = offsetPoint(p0.x, p0.y, bearing - (Math.PI / 2), w0);
                const right0 = offsetPoint(p0.x, p0.y, bearing + (Math.PI / 2), w0);
                const left1 = offsetPoint(p1.x, p1.y, bearing - (Math.PI / 2), w1);
                const right1 = offsetPoint(p1.x, p1.y, bearing + (Math.PI / 2), w1);

                const segmentIrradiance = this.irradiance(rm);
                const opacity = this.opacityForIrradiance(segmentIrradiance, visualSaturationWm2, gamma);

                const ring = new OpenLayers.Geometry.LinearRing([
                    new OpenLayers.Geometry.Point(left0.x, left0.y),
                    new OpenLayers.Geometry.Point(left1.x, left1.y),
                    new OpenLayers.Geometry.Point(right1.x, right1.y),
                    new OpenLayers.Geometry.Point(right0.x, right0.y),
                    new OpenLayers.Geometry.Point(left0.x, left0.y)
                ]);

                features.push(new OpenLayers.Feature.Vector(
                    new OpenLayers.Geometry.Polygon([ring]),
                    {
                        rangeStartM: r0,
                        rangeEndM: r1,
                        rangeMidM: rm,
                        irradianceWm2: segmentIrradiance,
                        beamDiameterM: this.beamDiameter(rm)
                    },
                    {
                        fillColor: this.beamColorHex,
                        fillOpacity: opacity,
                        strokeOpacity: 0,
                        strokeWidth: 0,
                        graphicZIndex: 20
                    }
                ));
            }

            this.beamLayer.addFeatures(features);
        },

        drawSafetyOverlays() {
            if (!this.safetyLayer) {
                return;
            }

            this.safetyLayer.removeAllFeatures();

            if (!this.spec.showSafetyOverlays || !this.calc || !this.calc.safety) {
                return;
            }

            const safety = this.calc.safety;
            const ringDefinitions = [
                { key: "lfzedM", label: "LFZED", color: "#60a5fa" },
                { key: "czedM", label: "CZED", color: "#fbbf24" },
                { key: "szedM", label: "SZED", color: "#fb7185" },
                { key: "nohdM", label: "NOHD", color: "#ef4444" }
            ];

            const circles = [];
            for (const definition of ringDefinitions) {
                const radiusM = Number(safety[definition.key]);
                if (!Number.isFinite(radiusM) || radiusM <= 0) {
                    continue;
                }

                circles.push({
                    radiusM,
                    label: definition.label,
                    color: definition.color
                });
            }

            if (circles.length === 0) {
                return;
            }

            circles.sort((a, b) => b.radiusM - a.radiusM);

            const origin = this.lonLatToMercator(this.spec.originLon, this.spec.originLat);
            const center = new OpenLayers.Geometry.Point(origin.lon, origin.lat);
            const features = [];

            for (let index = 0; index < circles.length; index += 1) {
                const current = circles[index];
                const nextInner = circles[index + 1];
                const outer = OpenLayers.Geometry.Polygon.createRegularPolygon(center, current.radiusM, 80, 0);

                if (nextInner && nextInner.radiusM > 0 && nextInner.radiusM < current.radiusM) {
                    const inner = OpenLayers.Geometry.Polygon.createRegularPolygon(center, nextInner.radiusM, 80, 0);
                    const innerRing = inner && inner.components && inner.components[0] ? inner.components[0] : null;
                    if (innerRing && Array.isArray(innerRing.components)) {
                        innerRing.components.reverse();
                        outer.addComponent(innerRing);
                    }
                }

                features.push(new OpenLayers.Feature.Vector(
                    outer,
                    { zone: current.label, radiusM: current.radiusM },
                    {
                        fillColor: current.color,
                        fillOpacity: 0.08,
                        strokeColor: current.color,
                        strokeOpacity: 0.85,
                        strokeWidth: 1.3,
                        strokeDashstyle: "dash",
                        graphicZIndex: 40
                    }
                ));

                const labelPoint = offsetPoint(center.x, center.y, degToRad(55), current.radiusM);
                features.push(new OpenLayers.Feature.Vector(
                    new OpenLayers.Geometry.Point(labelPoint.x, labelPoint.y),
                    { zone: current.label, radiusM: current.radiusM },
                    {
                        label: `${current.label}: ${this.formatDistance(current.radiusM)}`,
                        fontColor: "#ffffff",
                        fontSize: "11px",
                        fontFamily: "system-ui, sans-serif",
                        fontWeight: "600",
                        labelOutlineColor: "rgba(15, 23, 42, 0.95)",
                        labelOutlineWidth: 3,
                        labelAlign: "lb",
                        pointRadius: 0,
                        fillOpacity: 0,
                        strokeOpacity: 0,
                        graphicZIndex: 45
                    }
                ));
            }

            this.safetyLayer.addFeatures(features);
        },

        visualBeamHalfWidth(rangeM) {
            return Math.max((this.beamDiameter(rangeM) / 2) * this.spec.visualExaggeration, 1.0);
        },

        opacityForIrradiance(irradianceWm2, visualSaturationWm2, gamma) {
            const normalized = clamp(irradianceWm2 / Math.max(0.000001, visualSaturationWm2), 0, 1);
            return clamp(0.02 + (0.62 * Math.pow(normalized, Math.max(0.05, gamma))), 0.02, 0.64);
        },

        drawMarkers() {
            this.markerLayer.removeAllFeatures();

            const origin = this.lonLatToMercator(this.spec.originLon, this.spec.originLat);
            const target = this.lonLatToMercator(this.spec.targetLon, this.spec.targetLat);

            this.originFeature = this.createOriginPointFeature(origin.lon, origin.lat);
            this.targetFeature = this.createTargetPointFeature(target.lon, target.lat);

            this.markerLayer.addFeatures([this.originFeature, this.targetFeature]);
        },

        createOriginPointFeature(x, y) {
            return new OpenLayers.Feature.Vector(
                new OpenLayers.Geometry.Point(x, y),
                { role: "origin" },
                {
                    pointRadius: 8,
                    fillColor: this.beamColorHex,
                    fillOpacity: 0.95,
                    strokeColor: "#ffffff",
                    strokeWidth: 2,
                    graphicZIndex: 100
                }
            );
        },

        createTargetPointFeature(x, y) {
            return new OpenLayers.Feature.Vector(
                new OpenLayers.Geometry.Point(x, y),
                { role: "target" },
                {
                    externalGraphic: this.targetCrosshairDataUri,
                    graphicWidth: 24,
                    graphicHeight: 24,
                    graphicXOffset: -12,
                    graphicYOffset: -12,
                    graphicOpacity: 1,
                    graphicZIndex: 101
                }
            );
        },

        updateTargetCrosshairGraphic() {
            const nextGraphic = createTargetCrosshairDataUri();
            if (this.targetCrosshairDataUri === nextGraphic) {
                return;
            }

            this.targetCrosshairDataUri = nextGraphic;
            if (!this.targetFeature || !this.markerLayer) {
                return;
            }

            this.targetFeature.style = this.targetFeature.style || {};
            this.targetFeature.style.externalGraphic = this.targetCrosshairDataUri;
            this.markerLayer.drawFeature(this.targetFeature);
        },

        updateMarkerStyles() {
            if (!this.markerLayer) {
                return;
            }

            if (this.originFeature) {
                this.originFeature.style = this.originFeature.style || {};
                this.originFeature.style.fillColor = this.beamColorHex;
                this.originFeature.style.strokeColor = "#ffffff";
                this.originFeature.style.strokeWidth = 2;
                this.markerLayer.drawFeature(this.originFeature);
            }

            this.updateTargetCrosshairGraphic();
        },

        moveMarkers() {
            this.moveFeatureToLonLat(this.originFeature, this.spec.originLon, this.spec.originLat);
            this.moveFeatureToLonLat(this.targetFeature, this.spec.targetLon, this.spec.targetLat);
        },

        moveFeatureToLonLat(feature, lon, lat) {
            if (!feature) {
                return;
            }

            const point = this.lonLatToMercator(lon, lat);
            feature.geometry.x = point.lon;
            feature.geometry.y = point.lat;
            feature.geometry.clearBounds();
            this.markerLayer.drawFeature(feature);
        },

        updatePointFromFeature(feature) {
            const lonLat = this.mercatorToLonLat(feature.geometry.x, feature.geometry.y);
            if (feature.attributes.role === "origin") {
                this.spec.originLon = Number(lonLat.lon.toFixed(6));
                this.spec.originLat = Number(lonLat.lat.toFixed(6));
            }
            else if (feature.attributes.role === "target") {
                this.spec.targetLon = Number(lonLat.lon.toFixed(6));
                this.spec.targetLat = Number(lonLat.lat.toFixed(6));
            }
        },

        lonLatToMercator(lon, lat) {
            return new OpenLayers.LonLat(lon, lat).transform(
                new OpenLayers.Projection("EPSG:4326"),
                this.map.getProjectionObject()
            );
        },

        mercatorToLonLat(x, y) {
            return new OpenLayers.LonLat(x, y).transform(
                this.map.getProjectionObject(),
                new OpenLayers.Projection("EPSG:4326")
            );
        },

        runSelfTests() {
            const savedSpec = this.spec;
            this.spec = cloneSpec(defaultSpec);
            this.spec.atmosphericLossDbPerKmAt550 = 0;

            const expectedDiameterAt1000M = 0.020 + (1000 * 0.001);
            this.assertNearlyEqual(this.beamDiameter(1000), expectedDiameterAt1000M, 0.0000001, "beam diameter at 1000 m");

            const expectedRadius = expectedDiameterAt1000M / 2;
            const expectedArea = Math.PI * expectedRadius * expectedRadius;
            const expectedIrradiance = 20 / expectedArea;
            this.assertNearlyEqual(this.irradiance(1000), expectedIrradiance, 0.0000001, "irradiance at 1000 m");

            const cutoff = this.calculateCutoffRange();
            this.assertNearlyEqual(this.irradiance(cutoff), this.spec.cutoffWm2, 0.0005, "cutoff irradiance check");

            this.spec.divergenceMrad = 0.001;
            this.spec.apertureMm = 1;
            this.spec.wavelengthNm = 1064;
            this.spec.beamQualityM2 = 2;
            const diffractionFloorMrad = this.getDiffractionLimitedFullAngleRad() * 1000;
            const effectiveDivergenceMrad = this.getEffectiveFullAngleDivergenceRad() * 1000;
            if (!(effectiveDivergenceMrad >= diffractionFloorMrad)) {
                throw new Error("Self-test failed: effective divergence should respect diffraction floor.");
            }

            this.spec.atmosphericLossDbPerKmAt550 = 1;
            this.spec.atmosphericWavelengthExponent = 1;
            const nearTransmission = this.getAtmosphericTransmission(1000);
            const farTransmission = this.getAtmosphericTransmission(5000);
            if (!(nearTransmission > farTransmission)) {
                throw new Error("Self-test failed: atmospheric transmission should decrease with distance.");
            }

            const north = offsetPoint(0, 0, degToRad(0), 100);
            this.assertNearlyEqual(north.x, 0, 0.0000001, "north x");
            this.assertNearlyEqual(north.y, 100, 0.0000001, "north y");

            const east = offsetPoint(0, 0, degToRad(90), 100);
            this.assertNearlyEqual(east.x, 100, 0.0000001, "east x");
            this.assertNearlyEqual(east.y, 0, 0.0000001, "east y");

            const lowOpacity = this.opacityForIrradiance(0.1, 1, 1);
            const highOpacity = this.opacityForIrradiance(0.5, 1, 1);
            if (!(highOpacity > lowOpacity)) {
                throw new Error("Self-test failed: opacity should increase with irradiance.");
            }

            this.spec = savedSpec;
        },

        assertNearlyEqual(actual, expected, tolerance, name) {
            if (Math.abs(actual - expected) > tolerance) {
                throw new Error(`Self-test failed: ${name}. Expected ${expected}, got ${actual}.`);
            }
        },

        formatDistance(value) {
            return `${formatNumber(value, 0)} m`;
        },

        formatMeters(value, decimals) {
            return `${formatNumber(value, decimals)} m`;
        },

        formatIrradiance(value) {
            return `${formatNumber(value, 4)} W/m²`;
        },

        formatBearing(value) {
            return `${formatNumber(value, 1)}°`;
        },

        formatMrad(value) {
            return `${formatNumber(value, 3)} mrad`;
        },

        formatDbPerKm(value) {
            return `${formatNumber(value, 3)} dB/km`;
        },

        formatPercent(value) {
            return `${formatNumber(Math.max(0, value) * 100, 2)}%`;
        },

        formatSafetyDistance(value) {
            if (!Number.isFinite(value)) {
                return "N/A";
            }

            return this.formatDistance(value);
        },

        showEffectiveDivergence() {
            return Math.abs(this.calc.effectiveDivergenceMrad - this.spec.divergenceMrad) > 0.0005;
        },

        setStatus(message, isError) {
            this.statusMessage = message;
            this.statusError = Boolean(isError);
        }
    }));
});
