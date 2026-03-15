document.addEventListener("alpine:init", () => {
    const tools = window.ramnLabsTools;
    const preferencesStore = window.preferencesStore;
    if (!tools) {
        return;
    }
    const geohashBase32 = "0123456789bcdefghjkmnpqrstuvwxyz";

    function formatCoordinate(value) {
        return Number(value).toFixed(6);
    }

    function createPointWkt(lon, lat) {
        return `POINT (${formatCoordinate(lon)} ${formatCoordinate(lat)})`;
    }

    function createLatLonPair(lat, lon) {
        return `${formatCoordinate(lat)}, ${formatCoordinate(lon)}`;
    }

    function createBoundsWkt(bounds) {
        if (!bounds) {
            return null;
        }

        const minLon = formatCoordinate(bounds.minLon);
        const minLat = formatCoordinate(bounds.minLat);
        const maxLon = formatCoordinate(bounds.maxLon);
        const maxLat = formatCoordinate(bounds.maxLat);
        return `POLYGON ((${minLon} ${minLat}, ${minLon} ${maxLat}, ${maxLon} ${maxLat}, ${maxLon} ${minLat}, ${minLon} ${minLat}))`;
    }

    function isValidGeohash(value) {
        if (!value) {
            return false;
        }

        return /^[0-9bcdefghjkmnpqrstuvwxyz]+$/i.test(value);
    }

    function precisionFromZoom(zoom) {
        const z = Math.max(0, Math.floor(Number(zoom) || 0));
        if (z <= 3) {
            return 1;
        }
        if (z <= 5) {
            return 2;
        }
        if (z <= 7) {
            return 3;
        }
        if (z <= 9) {
            return 4;
        }
        if (z <= 11) {
            return 5;
        }
        if (z <= 13) {
            return 6;
        }
        if (z <= 15) {
            return 7;
        }
        if (z <= 17) {
            return 8;
        }
        if (z <= 18) {
            return 9;
        }
        if (z <= 19) {
            return 10;
        }
        if (z <= 21) {
            return 11;
        }
        return 12;
    }

    Alpine.data("geohashBrowserTool", () => ({
        autoPrecisionEnabled: true,
        manualPrecision: 6,
        showLabels: true,

        zoom: 5,
        effectiveStartPrecision: 3,
        renderedLevelCount: 0,
        exactGeohash: null,
        selectedCellGeohash: null,
        manualGeohashInput: "",
        manualGeohashError: null,
        selectedPrecisionOverride: null,
        hasSelectedPoint: false,
        selectedPointWkt: null,
        selectedPointLatLon: null,
        selectedCellBoundsWkt: null,
        renderWarning: null,

        map: null,
        mapThemeController: null,
        cellLayer: null,
        labelLayer: null,
        mapMaximized: false,
        maximizedTopOffset: 0,
        resizeHandler: null,

        init() {
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
            });
        },

        initializeMap() {
            if (!this.$refs.map) {
                return;
            }

            this.map = L.map(this.$refs.map, {
                zoomControl: true,
                attributionControl: true,
                preferCanvas: true,
                maxZoom: 24
            });

            this.map.setView([55, 12], 5);

            this.mapThemeController = tools.createLeafletThemeController(this.map);
            this.mapThemeController.init();

            this.cellLayer = L.layerGroup().addTo(this.map);
            this.labelLayer = L.layerGroup().addTo(this.map);

            this.map.on("zoomend", () => {
                this.zoom = this.map.getZoom();
                this.refreshFromLastClick();
            });

            this.map.on("click", (event) => {
                this.handleMapClick(event);
            });

            this.zoom = this.map.getZoom();
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

        getEffectiveStartPrecision() {
            if (this.autoPrecisionEnabled) {
                return precisionFromZoom(this.zoom);
            }

            const value = Number(this.manualPrecision);
            if (!Number.isFinite(value)) {
                return 6;
            }

            return Math.min(12, Math.max(1, Math.floor(value)));
        },

        refreshFromLastClick() {
            if (!this.exactGeohash) {
                return;
            }

            this.renderHierarchyFromExact();
        },

        handleMapClick(event) {
            if (!event || !event.latlng) {
                return;
            }

            const lat = Number(event.latlng.lat);
            const lng = Number(event.latlng.lng);
            const encoded = tools.encodeGeohash(lat, lng, 12);
            if (!encoded) {
                this.renderWarning = "Unable to compute geohash for clicked location.";
                return;
            }

            this.exactGeohash = encoded;
            this.manualGeohashError = null;
            this.selectedPrecisionOverride = null;
            this.hasSelectedPoint = true;
            this.selectedPointWkt = createPointWkt(lng, lat);
            this.selectedPointLatLon = createLatLonPair(lat, lng);
            this.renderHierarchyFromExact();
        },

        selectManualGeohashFromInput() {
            const normalized = (this.manualGeohashInput || "").trim().toLowerCase();
            if (!normalized) {
                this.clearRendered();
                return;
            }

            if (!isValidGeohash(normalized)) {
                this.manualGeohashError = "Invalid geohash characters.";
                return;
            }

            const bounds = tools.decodeGeohashBounds(normalized);
            if (!bounds) {
                this.manualGeohashError = "Unable to decode geohash.";
                return;
            }

            this.manualGeohashError = null;
            this.exactGeohash = normalized;
            this.selectedPrecisionOverride = normalized.length;
            this.hasSelectedPoint = false;
            this.selectedPointWkt = null;
            this.selectedPointLatLon = null;

            const leafletBounds = [
                [bounds.minLat, bounds.minLon],
                [bounds.maxLat, bounds.maxLon]
            ];
            this.map.fitBounds(leafletBounds, { padding: [24, 24], maxZoom: 24 });
            this.renderHierarchyFromExact();
        },

        renderHierarchyFromExact() {
            if (!this.map || !this.cellLayer || !this.labelLayer || !this.exactGeohash) {
                return;
            }

            this.zoom = this.map.getZoom();
            const precision = this.selectedPrecisionOverride ?? this.getEffectiveStartPrecision();
            this.effectiveStartPrecision = Math.min(precision, this.exactGeohash.length);
            this.selectedCellGeohash = this.effectiveStartPrecision > 0
                ? this.exactGeohash.substring(0, this.effectiveStartPrecision)
                : null;
            const selectedBounds = this.selectedCellGeohash
                ? tools.decodeGeohashBounds(this.selectedCellGeohash)
                : null;
            this.selectedCellBoundsWkt = createBoundsWkt(selectedBounds);
            this.renderWarning = null;
            this.drawHierarchyCells();
        },

        drawHierarchyCells() {
            this.cellLayer.clearLayers();
            this.labelLayer.clearLayers();

            if (!this.exactGeohash) {
                this.renderedLevelCount = 0;
                return;
            }

            const startPrecision = Math.min(this.effectiveStartPrecision, this.exactGeohash.length);
            let renderedLevels = 0;
            for (let precision = startPrecision; precision >= 0; precision -= 1) {
                const clickedPathCell = precision === 0 ? "" : this.exactGeohash.substring(0, precision);
                const cellsAtLevel = [];

                if (precision === 0) {
                    cellsAtLevel.push({
                        geohash: "",
                        label: "0: world",
                        bounds: { minLat: -90, maxLat: 90, minLon: -180, maxLon: 180 }
                    });
                }
                else {
                    const parentPrefix = precision === 1 ? "" : this.exactGeohash.substring(0, precision - 1);
                    for (const character of geohashBase32) {
                        const geohash = `${parentPrefix}${character}`;
                        const bounds = tools.decodeGeohashBounds(geohash);
                        if (!bounds) {
                            continue;
                        }

                        cellsAtLevel.push({
                            geohash,
                            label: `${precision}: ${geohash}`,
                            bounds
                        });
                    }
                }

                for (const cell of cellsAtLevel) {
                    const isClickedBranchCell = cell.geohash === clickedPathCell;
                    const isTopLevelHighlight = precision === startPrecision && isClickedBranchCell;
                    const strokeWeight = isClickedBranchCell ? 1.5 : Math.max(0.55, 1.0 - (precision * 0.025));
                    const strokeColor = isTopLevelHighlight ? "#fd7e14" : "#0d6efd";
                    const fillColor = isTopLevelHighlight ? "#fd7e14" : "#0d6efd";
                    const fillOpacity = isTopLevelHighlight ? 0.12 : 0;

                    const southWest = [cell.bounds.minLat, cell.bounds.minLon];
                    const northEast = [cell.bounds.maxLat, cell.bounds.maxLon];
                    L.rectangle([southWest, northEast], {
                        color: strokeColor,
                        weight: strokeWeight,
                        fillColor,
                        fillOpacity
                    }).addTo(this.cellLayer);

                    if (this.showLabels) {
                        const centerLat = (cell.bounds.minLat + cell.bounds.maxLat) / 2;
                        const centerLon = (cell.bounds.minLon + cell.bounds.maxLon) / 2;
                        const lastChar = cell.geohash.length > 0 ? cell.geohash.substring(cell.geohash.length - 1) : "0";
                        L.marker([centerLat, centerLon], {
                            interactive: false,
                            keyboard: false,
                            icon: L.divIcon({
                                className: "geohash-cell-label",
                                html: `<span>${lastChar}</span>`,
                                iconSize: [0, 0],
                                iconAnchor: [0, 0]
                            })
                        }).addTo(this.labelLayer);
                    }
                }

                renderedLevels += 1;
            }

            this.renderedLevelCount = renderedLevels;
        },

        clearRendered() {
            this.exactGeohash = null;
            this.selectedCellGeohash = null;
            this.selectedPrecisionOverride = null;
            this.manualGeohashError = null;
            this.hasSelectedPoint = false;
            this.selectedPointWkt = null;
            this.selectedPointLatLon = null;
            this.selectedCellBoundsWkt = null;
            this.renderedLevelCount = 0;
            this.renderWarning = null;

            if (this.cellLayer) {
                this.cellLayer.clearLayers();
            }

            if (this.labelLayer) {
                this.labelLayer.clearLayers();
            }
        },

        async copyExactGeohash() {
            if (!this.exactGeohash) {
                return;
            }

            await this.copyText(this.exactGeohash);
            tools.notifySuccess("Copied", `Copied precision 12 geohash ${this.exactGeohash}.`);
        },

        async copySelectedCellGeohash() {
            if (!this.selectedCellGeohash) {
                return;
            }

            await this.copyText(this.selectedCellGeohash);
            tools.notifySuccess("Copied", `Copied selected cell geohash ${this.selectedCellGeohash}.`);
        },

        async copySelectedPointWkt() {
            if (!this.selectedPointWkt) {
                return;
            }

            await this.copyText(this.selectedPointWkt);
            tools.notifySuccess("Copied", "Copied selected point WKT.");
        },

        async copySelectedPointLatLon() {
            if (!this.selectedPointLatLon) {
                return;
            }

            await this.copyText(this.selectedPointLatLon);
            tools.notifySuccess("Copied", "Copied selected point lat/lon.");
        },

        async copySelectedCellBoundsWkt() {
            if (!this.selectedCellBoundsWkt) {
                return;
            }

            await this.copyText(this.selectedCellBoundsWkt);
            tools.notifySuccess("Copied", "Copied selected cell bbox WKT.");
        },

        async copyText(text) {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
                await navigator.clipboard.writeText(text);
                return;
            }

            const textArea = document.createElement("textarea");
            textArea.value = text;
            textArea.style.position = "fixed";
            textArea.style.opacity = "0";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            document.execCommand("copy");
            document.body.removeChild(textArea);
        },

        destroy() {
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
