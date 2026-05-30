document.addEventListener('alpine:init', () => {
    const preferencesStore = window.preferencesStore;
    const maxRenderedSegments = 900;
    const specPreferenceKey = 'ramnlabs.searchlight.spec.v1';
    const mapViewPreferenceKey = 'ramnlabs.searchlight.map-view.v1';
    const panePreferenceKey = 'ramnlabs.searchlight.panes.v1';

    const defaultSpec = Object.freeze({
        originLat: 63.4305,
        originLon: 10.3951,
        targetLat: 63.4432,
        targetLon: 10.4318,
        oneLuxDistanceM: 5000,
        lensDiameterCm: 25,
        cctK: 5700,
        dimmingPercent: 100,
        beamMode: 'fixed',
        fixedBeamAngleDeg: 4,
        zoomMinBeamAngleDeg: 0.8,
        zoomMaxBeamAngleDeg: 14,
        zoomPercent: 85,
        zoomOpticalEfficiency: 1,
        spillRatio: 0.2,
        spillFieldAngleDeg: 28,
        spillSoftness: 0.7,
        enableAtmosphericEffects: true,
        atmosphericLossDbPerKmAt550: 0.15,
        atmosphericWavelengthExponent: 1.1,
        visualExaggeration: 1,
        segmentsPer100m: 1,
        showSpillOverlay: true,
        visualSaturationLux: 5,
        cutoffLux: 0.02
    });

    function cloneSpec(spec) {
        return JSON.parse(JSON.stringify(spec));
    }

    function isFiniteCoordinate(value) {
        return typeof value === 'number' && Number.isFinite(value);
    }

    function clamp(value, min, max) {
        if (!Number.isFinite(value)) {
            return min;
        }

        return Math.min(max, Math.max(min, value));
    }

    function formatNumber(value, decimals) {
        if (!Number.isFinite(value)) {
            return '-';
        }

        return Number(value).toLocaleString(undefined, {
            maximumFractionDigits: decimals,
            minimumFractionDigits: decimals > 0 && Math.abs(value) < 10 ? Math.min(2, decimals) : 0
        });
    }

    function degToRad(deg) {
        return (Number(deg) || 0) * (Math.PI / 180);
    }

    function radToDeg(rad) {
        return rad * (180 / Math.PI);
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
        return clamped.toString(16).padStart(2, '0');
    }

    function rgbToHex(r, g, b) {
        return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
    }

    function hexToRgb(hex) {
        if (typeof hex !== 'string') {
            return null;
        }

        const clean = hex.trim().replace('#', '');
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
            return fromHex || toHex || '#ffffff';
        }

        const t = clamp(Number(amount), 0, 1);
        return rgbToHex(
            from.r + ((to.r - from.r) * t),
            from.g + ((to.g - from.g) * t),
            from.b + ((to.b - from.b) * t)
        );
    }

    function kelvinToHex(cctK) {
        const temp = clamp(Number(cctK), 1000, 40000) / 100;
        let red;
        let green;
        let blue;

        if (temp <= 66) {
            red = 255;
            green = 99.4708025861 * Math.log(temp) - 161.1195681661;
            blue = temp <= 19 ? 0 : (138.5177312231 * Math.log(temp - 10)) - 305.0447927307;
        }
        else {
            red = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
            green = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
            blue = 255;
        }

        return rgbToHex(red, green, blue);
    }

    function createTargetCrosshairDataUri(strokeColor) {
        const stroke = strokeColor || '#ffffff';
        const svg = [
            "<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'>",
            `<circle cx='20' cy='20' r='11' fill='none' stroke='${stroke}' stroke-width='2'/>`,
            `<line x1='20' y1='2' x2='20' y2='10' stroke='${stroke}' stroke-width='2.4' stroke-linecap='round'/>`,
            `<line x1='20' y1='30' x2='20' y2='38' stroke='${stroke}' stroke-width='2.4' stroke-linecap='round'/>`,
            `<line x1='2' y1='20' x2='10' y2='20' stroke='${stroke}' stroke-width='2.4' stroke-linecap='round'/>`,
            `<line x1='30' y1='20' x2='38' y2='20' stroke='${stroke}' stroke-width='2.4' stroke-linecap='round'/>`,
            `<circle cx='20' cy='20' r='2.2' fill='${stroke}'/>`,
            '</svg>'
        ].join('');

        return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }

    function createDefaultPaneState() {
        return {
            calculated: {
                undocked: true,
                left: null,
                top: null
            }
        };
    }

    Alpine.data('searchlightTool', () => ({
        spec: cloneSpec(defaultSpec),
        calc: {
            targetDistanceM: 0,
            targetIlluminanceLux: 0,
            targetCoreDiameterM: 0,
            targetSpillDiameterM: 0,
            cutoffRangeM: 0,
            oneLuxRangeM: 0,
            bearingDeg: 0,
            bearingRad: 0,
            activeBeamAngleDeg: 0,
            referenceBeamAngleDeg: 0,
            effectiveCenterCandela: 0,
            targetTransmissionFraction: 1,
            atmosphericLossDbPerKmAtEffectiveWavelength: 0,
            effectiveWavelengthNm: 550,
            renderedSegments: 0
        },
        map: null,
        lightBaseLayer: null,
        darkBaseLayer: null,
        coreLayer: null,
        spillLayer: null,
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
        beamColorHex: '#f8f9fa',
        beamColorDescription: 'Neutral white beam color',
        targetCrosshairDataUri: createTargetCrosshairDataUri('#ffffff'),
        statusMessage: null,
        statusError: false,
        mapActionMenuVisible: false,
        mapActionMenuX: 12,
        mapActionMenuY: 12,
        mapActionLonLat: null,
        paneState: createDefaultPaneState(),
        paneAutoDocked: {
            calculated: false
        },
        activePaneDrag: null,
        paneDragMoveHandler: null,
        paneDragUpHandler: null,
        hasSavedMapView: false,
        navbarCollapseElement: null,
        navbarCollapseShownHandler: null,
        navbarCollapseHiddenHandler: null,

        init() {
            this.loadSpecPreference();
            this.mapMaximized = true;
            this.updateMapMaximizedOffset();
            document.body.classList.add('map-fullscreen-active');
            this.loadPanePreference();

            this.resizeHandler = () => {
                if (this.mapMaximized) {
                    this.updateMapMaximizedOffset();
                }

                this.syncPaneDockingForViewport();

                if (this.paneState.calculated && this.paneState.calculated.undocked) {
                    this.ensurePaneInViewport('calculated');
                }

                this.ensureMapSize();
            };
            window.addEventListener('resize', this.resizeHandler);

            this.navbarCollapseElement = document.getElementById('mainNavbarCollapse');
            this.navbarCollapseShownHandler = () => {
                this.onNavbarCollapseStateChanged();
            };
            this.navbarCollapseHiddenHandler = () => {
                this.onNavbarCollapseStateChanged();
            };
            if (this.navbarCollapseElement) {
                this.navbarCollapseElement.addEventListener('shown.bs.collapse', this.navbarCollapseShownHandler);
                this.navbarCollapseElement.addEventListener('hidden.bs.collapse', this.navbarCollapseHiddenHandler);
            }

            this.errorHandler = (event) => {
                this.setStatus(`Runtime error: ${event.message || 'Unknown error.'}`, true);
            };
            window.addEventListener('error', this.errorHandler);

            this.rejectionHandler = (event) => {
                this.setStatus(`Unhandled rejection: ${String(event.reason || 'Unknown error.')}`, true);
            };
            window.addEventListener('unhandledrejection', this.rejectionHandler);

            this.syncPaneDockingForViewport();

            window.requestAnimationFrame(() => {
                try {
                    if (!this.initializeMap()) {
                        return;
                    }

                    this.normalizePanePlacements();
                    this.refresh(true);
                    if (!this.hasSavedMapView) {
                        this.fitToPoints();
                    }
                    this.ensureMapSize();
                }
                catch (error) {
                    this.setStatus(error && error.message ? error.message : 'Failed to initialize tool.', true);
                }
            });
        },

        destroy() {
            document.body.classList.remove('map-fullscreen-active');

            if (this.resizeHandler) {
                window.removeEventListener('resize', this.resizeHandler);
                this.resizeHandler = null;
            }

            if (this.themeObserver) {
                this.themeObserver.disconnect();
                this.themeObserver = null;
            }

            if (this.errorHandler) {
                window.removeEventListener('error', this.errorHandler);
                this.errorHandler = null;
            }

            if (this.rejectionHandler) {
                window.removeEventListener('unhandledrejection', this.rejectionHandler);
                this.rejectionHandler = null;
            }

            if (this.navbarCollapseElement) {
                if (this.navbarCollapseShownHandler) {
                    this.navbarCollapseElement.removeEventListener('shown.bs.collapse', this.navbarCollapseShownHandler);
                }
                if (this.navbarCollapseHiddenHandler) {
                    this.navbarCollapseElement.removeEventListener('hidden.bs.collapse', this.navbarCollapseHiddenHandler);
                }
            }
            this.navbarCollapseElement = null;
            this.navbarCollapseShownHandler = null;
            this.navbarCollapseHiddenHandler = null;

            if (this.dragControl && this.map) {
                this.dragControl.deactivate();
                this.map.removeControl(this.dragControl);
            }

            if (this.map) {
                this.map.destroy();
                this.map = null;
            }

            this.stopPaneDrag();
            this.closeMapActionMenu();
        },

        loadSpecPreference() {
            if (!preferencesStore || typeof preferencesStore.getPreference !== 'function') {
                return;
            }

            const saved = preferencesStore.getPreference(specPreferenceKey, null);
            if (!saved || typeof saved !== 'object') {
                return;
            }

            this.spec = {
                ...cloneSpec(defaultSpec),
                ...saved
            };
            this.normalizeSpec();
        },

        persistSpecPreference() {
            if (!preferencesStore || typeof preferencesStore.setPreference !== 'function') {
                return;
            }

            preferencesStore.setPreference(specPreferenceKey, this.spec);
        },

        loadPanePreference() {
            this.paneState = createDefaultPaneState();
            if (!preferencesStore || typeof preferencesStore.getPreference !== 'function') {
                this.applyDefaultPanePlacements();
                return;
            }

            const saved = preferencesStore.getPreference(panePreferenceKey, null);
            if (!saved || typeof saved !== 'object') {
                this.applyDefaultPanePlacements();
                return;
            }

            const pane = saved.calculated;
            if (!pane || typeof pane !== 'object') {
                this.applyDefaultPanePlacements();
                return;
            }

            this.paneState.calculated.undocked = Boolean(pane.undocked);
            this.paneState.calculated.left = isFiniteCoordinate(pane.left)
                ? pane.left
                : this.paneState.calculated.left;
            this.paneState.calculated.top = isFiniteCoordinate(pane.top)
                ? pane.top
                : this.paneState.calculated.top;

            this.applyDefaultPanePlacements();
        },

        persistPanePreference() {
            if (!preferencesStore || typeof preferencesStore.setPreference !== 'function') {
                return;
            }

            preferencesStore.setPreference(panePreferenceKey, this.paneState);
        },

        loadMapViewPreference() {
            this.hasSavedMapView = false;
            if (!preferencesStore || typeof preferencesStore.getPreference !== 'function') {
                return null;
            }

            const saved = preferencesStore.getPreference(mapViewPreferenceKey, null);
            if (!saved || typeof saved !== 'object') {
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
            if (!this.map || !preferencesStore || typeof preferencesStore.setPreference !== 'function') {
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
                this.setStatus('OpenLayers failed to load.', true);
                return false;
            }

            OpenLayers.ImgPath = 'https://cdnjs.cloudflare.com/ajax/libs/openlayers/2.13.1/img/';

            this.map = new OpenLayers.Map(this.$refs.map, {
                projection: new OpenLayers.Projection('EPSG:3857'),
                displayProjection: new OpenLayers.Projection('EPSG:4326'),
                units: 'm',
                controls: [
                    new OpenLayers.Control.Navigation(),
                    new OpenLayers.Control.Zoom(),
                    new OpenLayers.Control.Attribution()
                ]
            });

            this.lightBaseLayer = this.createCartoLayer('light_all', 'CARTO Positron');
            this.darkBaseLayer = this.createCartoLayer('dark_all', 'CARTO Dark Matter');
            this.spillLayer = new OpenLayers.Layer.Vector('Searchlight spill field', {
                rendererOptions: { zIndexing: true }
            });
            this.coreLayer = new OpenLayers.Layer.Vector('Searchlight core field', {
                rendererOptions: { zIndexing: true }
            });
            this.markerLayer = new OpenLayers.Layer.Vector('Searchlight markers', {
                rendererOptions: { zIndexing: true }
            });

            this.map.addLayers([this.lightBaseLayer, this.darkBaseLayer, this.spillLayer, this.coreLayer, this.markerLayer]);
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
                    this.closeMapActionMenu();
                    this.updatePointFromFeature(feature);
                    this.refreshDuringDrag(feature);
                },
                onComplete: (feature) => {
                    this.closeMapActionMenu();
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
                attributeFilter: ['data-bs-theme']
            });

            this.map.events.register('moveend', this, () => {
                this.persistMapViewPreference();
            });
            this.map.events.register('click', this, (event) => {
                this.openMapActionMenu(event);
            });
            this.map.events.register('movestart', this, () => {
                this.closeMapActionMenu();
            });

            return true;
        },

        createCartoLayer(styleName, layerName) {
            return new OpenLayers.Layer.XYZ(
                layerName,
                [
                    `https://a.basemaps.cartocdn.com/${styleName}/${'${z}'}/${'${x}'}/${'${y}'}.png`,
                    `https://b.basemaps.cartocdn.com/${styleName}/${'${z}'}/${'${x}'}/${'${y}'}.png`,
                    `https://c.basemaps.cartocdn.com/${styleName}/${'${z}'}/${'${x}'}/${'${y}'}.png`,
                    `https://d.basemaps.cartocdn.com/${styleName}/${'${z}'}/${'${x}'}/${'${y}'}.png`
                ],
                {
                    sphericalMercator: true,
                    wrapDateLine: true,
                    numZoomLevels: 20,
                    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
                }
            );
        },

        applyThemeBasemap() {
            if (!this.map || !this.lightBaseLayer || !this.darkBaseLayer) {
                return;
            }

            const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
            const targetLayer = isDark ? this.darkBaseLayer : this.lightBaseLayer;
            if (this.map.baseLayer !== targetLayer) {
                this.map.setBaseLayer(targetLayer);
            }

            this.updateTargetCrosshairGraphic();
        },

        toggleMapMaximized() {
            this.mapMaximized = true;
            this.updateMapMaximizedOffset();
            document.body.classList.add('map-fullscreen-active');

            this.$nextTick(() => {
                this.ensureMapSize();
            });
        },

        updateMapMaximizedOffset() {
            const navbar = document.querySelector('header .navbar');
            this.maximizedTopOffset = navbar ? Math.max(0, Math.ceil(navbar.getBoundingClientRect().bottom)) : 0;
        },

        isMobileLayout() {
            return window.innerWidth < 992;
        },

        onNavbarCollapseStateChanged() {
            this.updateMapMaximizedOffset();
            this.syncPaneDockingForViewport();
            if (this.paneState.calculated && this.paneState.calculated.undocked) {
                this.ensurePaneInViewport('calculated');
            }

            this.$nextTick(() => {
                this.ensureMapSize();
            });
        },

        syncPaneDockingForViewport() {
            const pane = this.paneState.calculated;
            if (!pane) {
                return;
            }

            if (this.isMobileLayout()) {
                if (!pane.undocked) {
                    return;
                }

                pane.undocked = false;
                this.paneAutoDocked.calculated = true;
                this.stopPaneDrag();
                return;
            }

            if (!this.paneAutoDocked.calculated) {
                return;
            }

            pane.undocked = true;
            this.paneAutoDocked.calculated = false;
            this.ensurePaneInViewport('calculated');
            this.stopPaneDrag();
        },

        ensureMapSize() {
            if (!this.map) {
                return;
            }

            this.map.updateSize();
        },

        refreshFromInputs(recreateMarkers) {
            this.closeMapActionMenu();
            this.normalizeSpec();
            this.persistSpecPreference();
            this.refresh(recreateMarkers === true);
        },

        resetDemo() {
            this.spec = cloneSpec(defaultSpec);
            this.persistSpecPreference();
            this.stopPaneDrag();
            this.paneState = createDefaultPaneState();
            this.applyDefaultPanePlacements();
            this.paneAutoDocked = {
                calculated: false
            };
            this.normalizePanePlacements();
            this.persistPanePreference();
            this.refresh(true);
            this.fitToPoints();
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

            this.closeMapActionMenu();

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

        getDefaultPanePlacement(paneKey) {
            const viewport = this.getPaneViewportRect();
            const { height } = this.getPaneDimensions(paneKey);
            const bottomTop = Math.max(viewport.minY, viewport.maxY - height);
            if (paneKey === 'calculated') {
                return { left: viewport.minX, top: bottomTop };
            }

            return { left: viewport.minX, top: bottomTop };
        },

        getPaneViewportRect() {
            const padding = 10;
            const mapElement = this.$refs && this.$refs.map ? this.$refs.map : null;
            if (mapElement && typeof mapElement.getBoundingClientRect === 'function') {
                const rect = mapElement.getBoundingClientRect();
                if (Number.isFinite(rect.left)
                    && Number.isFinite(rect.top)
                    && Number.isFinite(rect.width)
                    && Number.isFinite(rect.height)
                    && rect.width > 60
                    && rect.height > 60) {
                    return {
                        minX: Math.ceil(rect.left) + padding,
                        maxX: Math.floor(rect.right) - padding,
                        minY: Math.ceil(rect.top) + padding,
                        maxY: Math.floor(rect.bottom) - padding
                    };
                }
            }

            const minY = (this.maximizedTopOffset || 0) + 8;
            return {
                minX: 8,
                maxX: Math.max(8, window.innerWidth - 8),
                minY,
                maxY: Math.max(minY, window.innerHeight - 8)
            };
        },

        getPaneViewportDimensions() {
            const viewport = this.getPaneViewportRect();
            const availableWidth = Math.max(160, viewport.maxX - viewport.minX);
            const availableHeight = Math.max(160, viewport.maxY - viewport.minY);
            return {
                width: Math.min(420, availableWidth),
                height: Math.min(420, availableHeight)
            };
        },

        getPaneDimensions(paneKey) {
            const viewport = this.getPaneViewportDimensions();
            const refName = paneKey === 'calculated' ? 'paneCalculated' : null;
            const paneElement = refName && this.$refs ? this.$refs[refName] : null;
            const measuredHeight = paneElement ? paneElement.offsetHeight : null;
            const height = Number.isFinite(measuredHeight) && measuredHeight > 0
                ? Math.min(measuredHeight, viewport.height)
                : viewport.height;

            return {
                width: viewport.width,
                height
            };
        },

        applyDefaultPanePlacements() {
            const pane = this.paneState.calculated;
            if (!pane) {
                return;
            }

            if (!isFiniteCoordinate(pane.left) || !isFiniteCoordinate(pane.top)) {
                const placement = this.getDefaultPanePlacement('calculated');
                pane.left = placement.left;
                pane.top = placement.top;
            }
        },

        normalizePanePlacements() {
            let changed = false;
            this.applyDefaultPanePlacements();

            const pane = this.paneState.calculated;
            if (pane && pane.undocked) {
                const beforeLeft = pane.left;
                const beforeTop = pane.top;
                this.ensurePaneInViewport('calculated');
                if (beforeLeft !== pane.left || beforeTop !== pane.top) {
                    changed = true;
                }
            }

            if (changed) {
                this.persistPanePreference();
            }
        },

        getPaneStyle(paneKey) {
            const pane = this.paneState[paneKey];
            if (!pane || !pane.undocked) {
                return '';
            }

            if (!isFiniteCoordinate(pane.left) || !isFiniteCoordinate(pane.top)) {
                const placement = this.getDefaultPanePlacement(paneKey);
                pane.left = placement.left;
                pane.top = placement.top;
            }

            const { width } = this.getPaneDimensions(paneKey);
            return `left:${pane.left}px;top:${pane.top}px;width:${width}px;`;
        },

        togglePaneDock(paneKey) {
            const pane = this.paneState[paneKey];
            if (!pane) {
                return;
            }

            if (this.isMobileLayout() && !pane.undocked) {
                return;
            }

            pane.undocked = !pane.undocked;
            this.paneAutoDocked[paneKey] = false;
            if (pane.undocked) {
                const placement = this.getDefaultPanePlacement(paneKey);
                if (!isFiniteCoordinate(pane.left)) {
                    pane.left = placement.left;
                }
                if (!isFiniteCoordinate(pane.top)) {
                    pane.top = placement.top;
                }

                this.ensurePaneInViewport(paneKey);
            }

            this.persistPanePreference();
        },

        startPaneDrag(paneKey, event) {
            const pane = this.paneState[paneKey];
            if (!pane || !pane.undocked || !event || event.button !== 0) {
                return;
            }

            if (event.target && event.target.closest('button, a, input, select, textarea, label')) {
                return;
            }

            this.stopPaneDrag();
            this.activePaneDrag = {
                paneKey,
                offsetX: event.clientX - pane.left,
                offsetY: event.clientY - pane.top
            };

            this.paneDragMoveHandler = (moveEvent) => {
                this.onPaneDrag(moveEvent);
            };
            this.paneDragUpHandler = () => {
                this.stopPaneDrag();
                this.persistPanePreference();
            };

            document.addEventListener('mousemove', this.paneDragMoveHandler);
            document.addEventListener('mouseup', this.paneDragUpHandler);
        },

        onPaneDrag(event) {
            if (!this.activePaneDrag || !event) {
                return;
            }

            const pane = this.paneState[this.activePaneDrag.paneKey];
            if (!pane) {
                return;
            }

            pane.left = event.clientX - this.activePaneDrag.offsetX;
            pane.top = event.clientY - this.activePaneDrag.offsetY;
            this.ensurePaneInViewport(this.activePaneDrag.paneKey);
        },

        stopPaneDrag() {
            if (this.paneDragMoveHandler) {
                document.removeEventListener('mousemove', this.paneDragMoveHandler);
                this.paneDragMoveHandler = null;
            }

            if (this.paneDragUpHandler) {
                document.removeEventListener('mouseup', this.paneDragUpHandler);
                this.paneDragUpHandler = null;
            }

            this.activePaneDrag = null;
        },

        ensurePaneInViewport(paneKey) {
            const pane = this.paneState[paneKey];
            if (!pane) {
                return;
            }

            const viewport = this.getPaneViewportRect();
            const { width, height } = this.getPaneDimensions(paneKey);
            const minX = viewport.minX;
            const maxX = Math.max(minX, viewport.maxX - width);
            const minY = viewport.minY;
            const maxY = Math.max(minY, viewport.maxY - height);

            pane.left = clamp(Number(pane.left), minX, maxX);
            pane.top = clamp(Number(pane.top), minY, maxY);
        },

        openMapActionMenu(event) {
            if (!this.map || !event || !event.xy || !this.$refs.map) {
                return;
            }

            const mercatorLonLat = this.map.getLonLatFromViewPortPx(event.xy);
            if (!mercatorLonLat) {
                return;
            }

            const geoLonLat = this.mercatorToLonLat(mercatorLonLat.lon, mercatorLonLat.lat);
            this.mapActionLonLat = {
                lon: clamp(Number(geoLonLat.lon), -180, 180),
                lat: clamp(Number(geoLonLat.lat), -85, 85)
            };

            const width = this.$refs.map.clientWidth || 0;
            const height = this.$refs.map.clientHeight || 0;
            this.mapActionMenuX = clamp((event.xy.x || 0) + 10, 8, Math.max(8, width - 170));
            this.mapActionMenuY = clamp((event.xy.y || 0) + 10, 8, Math.max(8, height - 62));
            this.mapActionMenuVisible = true;
        },

        closeMapActionMenu() {
            this.mapActionMenuVisible = false;
            this.mapActionLonLat = null;
        },

        setOriginFromMapActionMenu() {
            if (!this.mapActionLonLat) {
                return;
            }

            this.spec.originLon = Number(this.mapActionLonLat.lon.toFixed(6));
            this.spec.originLat = Number(this.mapActionLonLat.lat.toFixed(6));
            this.persistSpecPreference();
            this.refresh(false);
            this.closeMapActionMenu();
        },

        setTargetFromMapActionMenu() {
            if (!this.mapActionLonLat) {
                return;
            }

            this.spec.targetLon = Number(this.mapActionLonLat.lon.toFixed(6));
            this.spec.targetLat = Number(this.mapActionLonLat.lat.toFixed(6));
            this.persistSpecPreference();
            this.refresh(false);
            this.closeMapActionMenu();
        },

        refresh(recreateMarkers) {
            if (!this.map) {
                return;
            }

            this.normalizeSpec();
            this.calculate();
            this.updateBeamColor();
            this.drawIllumination();
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
            this.drawIllumination();
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
            this.spec.oneLuxDistanceM = clamp(Number(this.spec.oneLuxDistanceM), 1, 500000);
            this.spec.lensDiameterCm = clamp(Number(this.spec.lensDiameterCm), 0.1, 500);
            this.spec.cctK = clamp(Number(this.spec.cctK), 1800, 12000);
            this.spec.dimmingPercent = clamp(Number(this.spec.dimmingPercent), 0, 100);
            this.spec.beamMode = this.spec.beamMode === 'fixed' ? 'fixed' : 'zoom';
            this.spec.fixedBeamAngleDeg = clamp(Number(this.spec.fixedBeamAngleDeg), 0.1, 120);
            this.spec.zoomMinBeamAngleDeg = clamp(Number(this.spec.zoomMinBeamAngleDeg), 0.1, 60);
            this.spec.zoomMaxBeamAngleDeg = clamp(Number(this.spec.zoomMaxBeamAngleDeg), 0.2, 120);
            if (this.spec.zoomMaxBeamAngleDeg < this.spec.zoomMinBeamAngleDeg) {
                const min = this.spec.zoomMinBeamAngleDeg;
                this.spec.zoomMinBeamAngleDeg = this.spec.zoomMaxBeamAngleDeg;
                this.spec.zoomMaxBeamAngleDeg = min;
            }
            this.spec.zoomPercent = clamp(Number(this.spec.zoomPercent), 0, 100);
            this.spec.zoomOpticalEfficiency = clamp(Number(this.spec.zoomOpticalEfficiency), 0.5, 1);
            this.spec.spillRatio = clamp(Number(this.spec.spillRatio), 0, 0.95);
            this.spec.spillFieldAngleDeg = clamp(Number(this.spec.spillFieldAngleDeg), 0.2, 180);
            this.spec.spillSoftness = clamp(Number(this.spec.spillSoftness), 0.5, 3);
            this.spec.enableAtmosphericEffects = this.spec.enableAtmosphericEffects !== false;
            this.spec.atmosphericLossDbPerKmAt550 = clamp(Number(this.spec.atmosphericLossDbPerKmAt550), 0, 1000);
            this.spec.atmosphericWavelengthExponent = clamp(Number(this.spec.atmosphericWavelengthExponent), 0, 8);
            this.spec.visualExaggeration = clamp(Number(this.spec.visualExaggeration), 1, 120);
            this.spec.segmentsPer100m = clamp(Number(this.spec.segmentsPer100m), 0.2, 20);
            this.spec.showSpillOverlay = this.spec.showSpillOverlay !== false;
            this.spec.visualSaturationLux = clamp(Number(this.spec.visualSaturationLux), 0.001, 1000000000);
            this.spec.cutoffLux = clamp(Number(this.spec.cutoffLux), 0.000001, 1000000000);
        },

        calculate() {
            const origin = this.lonLatToMercator(this.spec.originLon, this.spec.originLat);
            const target = this.lonLatToMercator(this.spec.targetLon, this.spec.targetLat);

            const dx = target.lon - origin.lon;
            const dy = target.lat - origin.lat;
            const targetDistanceM = Math.max(0.001, Math.sqrt((dx * dx) + (dy * dy)));
            const bearingRad = Math.atan2(dx, dy);
            const bearingDeg = normalizeDegrees(radToDeg(bearingRad));
            const activeBeamAngleDeg = this.getActiveBeamAngleDeg();
            const referenceBeamAngleDeg = this.getReferenceBeamAngleDeg();
            const effectiveCenterCandela = this.getEffectiveCenterCandela();
            const oneLuxRangeM = this.calculateRangeForCenterlineLux(1);
            const cutoffRangeM = this.calculateRangeForCenterlineLux(this.spec.cutoffLux);
            const targetTransmissionFraction = this.getAtmosphericTransmission(targetDistanceM);
            const atmosphericLossDbPerKmAtEffectiveWavelength = this.getAtmosphericLossDbPerKmAtEffectiveWavelength();
            const effectiveWavelengthNm = this.getEffectiveAtmosphericWavelengthNm();

            this.calc = {
                targetDistanceM,
                targetIlluminanceLux: this.centerlineIlluminance(targetDistanceM),
                targetCoreDiameterM: this.beamDiameterAtDistance(targetDistanceM, this.getCoreHalfAngleDeg()),
                targetSpillDiameterM: this.beamDiameterAtDistance(targetDistanceM, this.getSpillHalfAngleDeg()),
                cutoffRangeM,
                oneLuxRangeM,
                bearingDeg,
                bearingRad,
                activeBeamAngleDeg,
                referenceBeamAngleDeg,
                effectiveCenterCandela,
                targetTransmissionFraction,
                atmosphericLossDbPerKmAtEffectiveWavelength,
                effectiveWavelengthNm,
                renderedSegments: this.segmentCountForRange(cutoffRangeM)
            };
        },

        getActiveBeamAngleDeg() {
            if (this.spec.beamMode === 'fixed') {
                return clamp(this.spec.fixedBeamAngleDeg, 0.1, 120);
            }

            const span = this.spec.zoomMaxBeamAngleDeg - this.spec.zoomMinBeamAngleDeg;
            const t = clamp(this.spec.zoomPercent / 100, 0, 1);
            return clamp(this.spec.zoomMaxBeamAngleDeg - (span * t), this.spec.zoomMinBeamAngleDeg, this.spec.zoomMaxBeamAngleDeg);
        },

        getReferenceBeamAngleDeg() {
            if (this.spec.beamMode === 'fixed') {
                return this.getActiveBeamAngleDeg();
            }

            return clamp(this.spec.zoomMinBeamAngleDeg, 0.1, 120);
        },

        getCoreHalfAngleDeg() {
            return Math.max(0.05, this.getActiveBeamAngleDeg() / 2);
        },

        getSpillHalfAngleDeg() {
            const coreHalf = this.getCoreHalfAngleDeg();
            const raw = Math.max(coreHalf, this.spec.spillFieldAngleDeg / 2);
            return raw * this.spec.spillSoftness;
        },

        coneSolidAngleSr(beamAngleDeg) {
            const halfRad = degToRad(Math.max(0.05, beamAngleDeg / 2));
            return Math.max(0.0000001, 2 * Math.PI * (1 - Math.cos(halfRad)));
        },

        getEffectiveCenterCandela() {
            const baseCandela = Math.pow(Math.max(1, this.spec.oneLuxDistanceM), 2);
            const dimFactor = clamp(this.spec.dimmingPercent / 100, 0, 1);

            if (this.spec.beamMode !== 'zoom') {
                return baseCandela * dimFactor;
            }

            const omegaRef = this.coneSolidAngleSr(this.getReferenceBeamAngleDeg());
            const omegaCurrent = this.coneSolidAngleSr(this.getActiveBeamAngleDeg());
            const zoomFactor = (omegaRef / omegaCurrent) * clamp(this.spec.zoomOpticalEfficiency, 0.5, 1);
            return baseCandela * dimFactor * zoomFactor;
        },

        getEffectiveAtmosphericWavelengthNm() {
            // Approximate warm-to-cool white mapping for attenuation scaling.
            const t = (clamp(this.spec.cctK, 1800, 12000) - 1800) / (12000 - 1800);
            return 620 - (160 * t);
        },

        getAtmosphericLossDbPerKmAtEffectiveWavelength() {
            if (!this.spec.enableAtmosphericEffects) {
                return 0;
            }

            const baseLossDbPerKm = Math.max(0, this.spec.atmosphericLossDbPerKmAt550);
            const exponent = Math.max(0, this.spec.atmosphericWavelengthExponent);
            const effectiveWavelengthNm = this.getEffectiveAtmosphericWavelengthNm();
            const wavelengthRatio = 550 / Math.max(300, effectiveWavelengthNm);
            return baseLossDbPerKm * Math.pow(wavelengthRatio, exponent);
        },

        getAtmosphericTransmission(rangeM) {
            if (!this.spec.enableAtmosphericEffects) {
                return 1;
            }

            const rangeKm = Math.max(0, rangeM) / 1000;
            const lossDbPerKm = this.getAtmosphericLossDbPerKmAtEffectiveWavelength();
            const totalLossDb = lossDbPerKm * rangeKm;
            return Math.pow(10, -totalLossDb / 10);
        },

        gaussianProfile(thetaRad, alphaDeg) {
            const alpha = Math.max(0.0001, alphaDeg);
            const thetaDeg = Math.abs(radToDeg(thetaRad));
            const ratio = thetaDeg / alpha;
            return Math.exp(-Math.log(2) * ratio * ratio);
        },

        angularProfile(thetaRad) {
            const s = clamp(this.spec.spillRatio, 0, 0.95);
            const core = this.gaussianProfile(thetaRad, this.getCoreHalfAngleDeg());
            const spill = this.gaussianProfile(thetaRad, this.getSpillHalfAngleDeg());
            return clamp(((1 - s) * core) + (s * spill), 0, 1);
        },

        illuminanceAt(rangeM, offAxisRad) {
            const range = Math.max(0.5, rangeM);
            const intensity = this.getEffectiveCenterCandela();
            const transmission = this.getAtmosphericTransmission(range);
            const profile = this.angularProfile(offAxisRad);
            return (intensity * transmission * profile) / (range * range);
        },

        centerlineIlluminance(rangeM) {
            return this.illuminanceAt(rangeM, 0);
        },

        calculateRangeForCenterlineLux(targetLux) {
            const thresholdLux = Math.max(0.0000001, targetLux);
            const maxRangeM = 350000;

            if (this.centerlineIlluminance(0.5) <= thresholdLux) {
                return 0;
            }

            if (this.centerlineIlluminance(maxRangeM) > thresholdLux) {
                return maxRangeM;
            }

            let low = 0.5;
            let high = maxRangeM;
            for (let index = 0; index < 72; index += 1) {
                const mid = (low + high) / 2;
                if (this.centerlineIlluminance(mid) > thresholdLux) {
                    low = mid;
                }
                else {
                    high = mid;
                }
            }

            return high;
        },

        beamDiameterAtDistance(rangeM, halfAngleDeg) {
            const lensDiameterM = Math.max(0, this.spec.lensDiameterCm / 100);
            const radius = Math.max(0, rangeM) * Math.tan(degToRad(Math.max(0.01, halfAngleDeg)));
            return lensDiameterM + (radius * 2);
        },

        segmentCountForRange(rangeM) {
            const requested = Math.ceil((Math.max(1, rangeM) / 100) * this.spec.segmentsPer100m);
            return Math.round(clamp(requested, 2, maxRenderedSegments));
        },

        updateBeamColor() {
            const cct = clamp(this.spec.cctK, 1800, 12000);
            const raw = kelvinToHex(cct);
            // Keep near-white appearance and avoid over-saturated tint.
            this.beamColorHex = blendHexColors(raw, '#ffffff', 0.35);

            if (cct < 3000) {
                this.beamColorDescription = 'Warm white';
            }
            else if (cct < 5000) {
                this.beamColorDescription = 'Neutral white';
            }
            else {
                this.beamColorDescription = 'Cool white';
            }
        },

        drawIllumination() {
            this.coreLayer.removeAllFeatures();
            this.spillLayer.removeAllFeatures();

            const origin = this.lonLatToMercator(this.spec.originLon, this.spec.originLat);
            const bearing = this.calc.bearingRad;
            const rangeM = Math.max(1, this.calc.cutoffRangeM);
            const segmentCount = this.segmentCountForRange(rangeM);
            const coreFeatures = [];
            const spillFeatures = [];
            const saturationLux = Math.max(0.000001, this.spec.visualSaturationLux);

            for (let index = 0; index < segmentCount; index += 1) {
                const t0 = index / segmentCount;
                const t1 = (index + 1) / segmentCount;
                const r0 = rangeM * t0;
                const r1 = rangeM * t1;
                const rm = rangeM * ((t0 + t1) / 2);

                const p0 = offsetPoint(origin.lon, origin.lat, bearing, r0);
                const p1 = offsetPoint(origin.lon, origin.lat, bearing, r1);

                const centerLux = this.centerlineIlluminance(rm);
                const coreHalfW0 = this.visualHalfWidthForAngle(r0, this.getCoreHalfAngleDeg());
                const coreHalfW1 = this.visualHalfWidthForAngle(r1, this.getCoreHalfAngleDeg());
                const spillHalfW0 = this.visualHalfWidthForAngle(r0, this.getSpillHalfAngleDeg());
                const spillHalfW1 = this.visualHalfWidthForAngle(r1, this.getSpillHalfAngleDeg());

                if (this.spec.showSpillOverlay) {
                    const spillOpacity = this.opacityForLux(centerLux * Math.max(0.03, this.spec.spillRatio), saturationLux * 0.65, 0.42, 0.005);
                    spillFeatures.push(this.createSegmentPolygonFeature(p0, p1, bearing, spillHalfW0, spillHalfW1, {
                        fillColor: this.beamColorHex,
                        fillOpacity: spillOpacity,
                        strokeOpacity: 0,
                        strokeWidth: 0,
                        graphicZIndex: 18
                    }));
                }

                const coreOpacity = this.opacityForLux(centerLux, saturationLux, 0.68, 0.02);
                coreFeatures.push(this.createSegmentPolygonFeature(p0, p1, bearing, coreHalfW0, coreHalfW1, {
                    fillColor: this.beamColorHex,
                    fillOpacity: coreOpacity,
                    strokeOpacity: 0,
                    strokeWidth: 0,
                    graphicZIndex: 24
                }));
            }

            if (spillFeatures.length > 0) {
                this.spillLayer.addFeatures(spillFeatures);
            }
            if (coreFeatures.length > 0) {
                this.coreLayer.addFeatures(coreFeatures);
            }
        },

        createSegmentPolygonFeature(p0, p1, bearing, halfW0, halfW1, style) {
            const left0 = offsetPoint(p0.x, p0.y, bearing - (Math.PI / 2), halfW0);
            const right0 = offsetPoint(p0.x, p0.y, bearing + (Math.PI / 2), halfW0);
            const left1 = offsetPoint(p1.x, p1.y, bearing - (Math.PI / 2), halfW1);
            const right1 = offsetPoint(p1.x, p1.y, bearing + (Math.PI / 2), halfW1);

            const ring = new OpenLayers.Geometry.LinearRing([
                new OpenLayers.Geometry.Point(left0.x, left0.y),
                new OpenLayers.Geometry.Point(left1.x, left1.y),
                new OpenLayers.Geometry.Point(right1.x, right1.y),
                new OpenLayers.Geometry.Point(right0.x, right0.y),
                new OpenLayers.Geometry.Point(left0.x, left0.y)
            ]);

            return new OpenLayers.Feature.Vector(
                new OpenLayers.Geometry.Polygon([ring]),
                null,
                style
            );
        },

        visualHalfWidthForAngle(rangeM, halfAngleDeg) {
            const lensRadiusM = Math.max(0, this.spec.lensDiameterCm / 200);
            const geometricRadius = lensRadiusM + (Math.max(0, rangeM) * Math.tan(degToRad(Math.max(0.01, halfAngleDeg))));
            return geometricRadius * this.spec.visualExaggeration;
        },

        opacityForLux(lux, saturationLux, maxOpacity, minOpacity) {
            const normalized = clamp(lux / Math.max(0.000001, saturationLux), 0, 1);
            return clamp(minOpacity + (maxOpacity * Math.pow(normalized, 0.65)), minOpacity, maxOpacity + minOpacity);
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
                { role: 'origin' },
                {
                    pointRadius: 8,
                    fillColor: this.beamColorHex,
                    fillOpacity: 0.95,
                    strokeColor: '#ffffff',
                    strokeWidth: 2,
                    graphicZIndex: 100
                }
            );
        },

        createTargetPointFeature(x, y) {
            return new OpenLayers.Feature.Vector(
                new OpenLayers.Geometry.Point(x, y),
                { role: 'target' },
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
            const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
            const stroke = isDark ? '#ffffff' : '#0f172a';
            const nextGraphic = createTargetCrosshairDataUri(stroke);
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
                this.originFeature.style.strokeColor = '#ffffff';
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
            if (feature.attributes.role === 'origin') {
                this.spec.originLon = Number(lonLat.lon.toFixed(6));
                this.spec.originLat = Number(lonLat.lat.toFixed(6));
            }
            else if (feature.attributes.role === 'target') {
                this.spec.targetLon = Number(lonLat.lon.toFixed(6));
                this.spec.targetLat = Number(lonLat.lat.toFixed(6));
            }
        },

        lonLatToMercator(lon, lat) {
            return new OpenLayers.LonLat(lon, lat).transform(
                new OpenLayers.Projection('EPSG:4326'),
                this.map.getProjectionObject()
            );
        },

        mercatorToLonLat(x, y) {
            return new OpenLayers.LonLat(x, y).transform(
                this.map.getProjectionObject(),
                new OpenLayers.Projection('EPSG:4326')
            );
        },

        formatDistance(value) {
            return `${formatNumber(value, 0)} m`;
        },

        formatMeters(value, decimals) {
            return `${formatNumber(value, decimals)} m`;
        },

        formatLux(value) {
            return `${formatNumber(value, 4)} lx`;
        },

        formatCandela(value) {
            return `${formatNumber(value, 0)} cd`;
        },

        formatDegrees(value) {
            return `${formatNumber(value, 2)}°`;
        },

        formatDbPerKm(value) {
            return `${formatNumber(value, 3)} dB/km`;
        },

        formatPercent(value) {
            return `${formatNumber(Math.max(0, value) * 100, 2)}%`;
        },

        setStatus(message, isError) {
            this.statusMessage = message;
            this.statusError = Boolean(isError);
        }
    }));
});
