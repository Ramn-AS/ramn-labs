document.addEventListener("alpine:init", () => {
    const preferencesStore = window.preferencesStore;
    const tools = window.ramnLabsTools;

    const settings = Object.freeze({
        filenameBase: "qr-code",
        defaultErrorCorrection: "M",
        defaultContent: "https://lab.ramn.no/",
        defaultForegroundColor: "#111111",
        defaultBackgroundColor: "#ffffff",
        defaultRasterSize: 1024,
        defaultMargin: 1,
        minRasterSize: 128,
        maxRasterSize: 4096,
        minMargin: 0,
        maxMargin: 16,
        modulePixels: 10
    });

    const preferencesKeys = Object.freeze({
        content: "ramnlabs.qr.content",
        errorCorrection: "ramnlabs.qr.errorCorrection",
        foregroundColor: "ramnlabs.qr.foregroundColor",
        backgroundColor: "ramnlabs.qr.backgroundColor",
        rasterSize: "ramnlabs.qr.rasterSize",
        margin: "ramnlabs.qr.margin"
    });

    const errorCorrectionLabels = Object.freeze({
        L: "Low",
        M: "Medium",
        Q: "Quartile",
        H: "High"
    });

    function clampInteger(value, fallback, min, max) {
        const number = Number(value);
        if (!Number.isFinite(number)) {
            return fallback;
        }

        return Math.min(max, Math.max(min, Math.round(number)));
    }

    function isHexColor(value) {
        return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
    }

    function normalizeErrorCorrection(value) {
        return Object.prototype.hasOwnProperty.call(errorCorrectionLabels, value)
            ? value
            : settings.defaultErrorCorrection;
    }

    function createTimestamp() {
        const date = new Date();
        const parts = [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0"),
            String(date.getHours()).padStart(2, "0"),
            String(date.getMinutes()).padStart(2, "0"),
            String(date.getSeconds()).padStart(2, "0")
        ];

        return `${parts[0]}${parts[1]}${parts[2]}-${parts[3]}${parts[4]}${parts[5]}`;
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function getFilename(extension) {
        return `${settings.filenameBase}-${createTimestamp()}.${extension}`;
    }

    function buildSvgMarkup(qr, foregroundColor, backgroundColor, margin) {
        const moduleCount = qr.getModuleCount();
        const quietZone = clampInteger(margin, settings.defaultMargin, settings.minMargin, settings.maxMargin);
        const cellSize = settings.modulePixels;
        const size = (moduleCount + (quietZone * 2)) * cellSize;
        const rects = [];

        for (let row = 0; row < moduleCount; row += 1) {
            for (let column = 0; column < moduleCount; column += 1) {
                if (!qr.isDark(row, column)) {
                    continue;
                }

                const x = (column + quietZone) * cellSize;
                const y = (row + quietZone) * cellSize;
                rects.push(`<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" />`);
            }
        }

        return [
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Generated QR code">`,
            `<rect width="100%" height="100%" fill="${backgroundColor}" />`,
            `<g fill="${foregroundColor}">`,
            rects.join(""),
            "</g>",
            "</svg>"
        ].join("");
    }

    function renderSvgToImage(svgMarkup) {
        return new Promise((resolve, reject) => {
            const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const image = new Image();

            image.onload = () => {
                URL.revokeObjectURL(url);
                resolve(image);
            };

            image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error("The browser could not render the SVG for raster export."));
            };

            image.src = url;
        });
    }

    Alpine.data("qrCodeGeneratorTool", () => ({
        content: settings.defaultContent,
        errorCorrection: settings.defaultErrorCorrection,
        foregroundColor: settings.defaultForegroundColor,
        backgroundColor: settings.defaultBackgroundColor,
        rasterSize: settings.defaultRasterSize,
        margin: settings.defaultMargin,
        svgMarkup: "",
        moduleCount: null,
        error: null,
        status: "Waiting for content.",

        init() {
            this.loadPreferences();
            this.generate();
        },

        get contentLength() {
            return typeof this.content === "string" ? this.content.length : 0;
        },

        get canDownload() {
            return this.svgMarkup.length > 0 && !this.error;
        },

        get errorCorrectionLabel() {
            return `EC ${this.errorCorrection} - ${errorCorrectionLabels[this.errorCorrection] || "Medium"}`;
        },

        get moduleCountText() {
            return Number.isInteger(this.moduleCount) ? `${this.moduleCount} x ${this.moduleCount}` : "-";
        },

        get previewMessage() {
            return this.error || "Enter content to generate a QR code.";
        },

        get rasterSizeText() {
            return `${this.rasterSize} x ${this.rasterSize} px`;
        },

        loadPreferences() {
            if (!preferencesStore || typeof preferencesStore.getPreference !== "function") {
                return;
            }

            const content = preferencesStore.getPreference(preferencesKeys.content, this.content);
            this.content = typeof content === "string" ? content : settings.defaultContent;

            this.errorCorrection = normalizeErrorCorrection(preferencesStore.getPreference(preferencesKeys.errorCorrection, this.errorCorrection));

            const foregroundColor = preferencesStore.getPreference(preferencesKeys.foregroundColor, this.foregroundColor);
            this.foregroundColor = isHexColor(foregroundColor) ? foregroundColor : settings.defaultForegroundColor;

            const backgroundColor = preferencesStore.getPreference(preferencesKeys.backgroundColor, this.backgroundColor);
            this.backgroundColor = isHexColor(backgroundColor) ? backgroundColor : settings.defaultBackgroundColor;

            this.rasterSize = clampInteger(
                preferencesStore.getPreference(preferencesKeys.rasterSize, this.rasterSize),
                settings.defaultRasterSize,
                settings.minRasterSize,
                settings.maxRasterSize);

            this.margin = clampInteger(
                preferencesStore.getPreference(preferencesKeys.margin, this.margin),
                settings.defaultMargin,
                settings.minMargin,
                settings.maxMargin);
        },

        persistPreferences() {
            if (!preferencesStore || typeof preferencesStore.setPreference !== "function") {
                return;
            }

            preferencesStore.setPreference(preferencesKeys.content, this.content);
            preferencesStore.setPreference(preferencesKeys.errorCorrection, this.errorCorrection);
            preferencesStore.setPreference(preferencesKeys.foregroundColor, this.foregroundColor);
            preferencesStore.setPreference(preferencesKeys.backgroundColor, this.backgroundColor);
            preferencesStore.setPreference(preferencesKeys.rasterSize, this.rasterSize);
            preferencesStore.setPreference(preferencesKeys.margin, this.margin);
        },

        normalizeRasterSize() {
            this.rasterSize = clampInteger(this.rasterSize, settings.defaultRasterSize, settings.minRasterSize, settings.maxRasterSize);
        },

        normalizeMargin() {
            this.margin = clampInteger(this.margin, settings.defaultMargin, settings.minMargin, settings.maxMargin);
        },

        generate() {
            this.errorCorrection = normalizeErrorCorrection(this.errorCorrection);
            this.foregroundColor = isHexColor(this.foregroundColor) ? this.foregroundColor : settings.defaultForegroundColor;
            this.backgroundColor = isHexColor(this.backgroundColor) ? this.backgroundColor : settings.defaultBackgroundColor;
            this.normalizeRasterSize();
            this.normalizeMargin();

            const content = typeof this.content === "string" ? this.content : "";
            if (!content.trim()) {
                this.svgMarkup = "";
                this.moduleCount = null;
                this.error = null;
                this.status = "Waiting for content.";
                return;
            }

            if (typeof qrcode !== "function") {
                this.svgMarkup = "";
                this.moduleCount = null;
                this.error = "QR library did not load. Check the browser connection and reload the page.";
                this.status = "Unavailable.";
                return;
            }

            try {
                const qr = qrcode(0, this.errorCorrection);
                qr.addData(content);
                qr.make();

                this.moduleCount = qr.getModuleCount();
                this.svgMarkup = buildSvgMarkup(qr, this.foregroundColor, this.backgroundColor, this.margin);
                this.error = null;
                this.status = "Ready.";
            }
            catch (error) {
                this.svgMarkup = "";
                this.moduleCount = null;
                this.error = error && error.message
                    ? `Could not generate QR code: ${error.message}`
                    : "Could not generate QR code.";
                this.status = "Error.";
            }
        },

        downloadSvg() {
            if (!this.canDownload) {
                return;
            }

            const blob = new Blob([this.svgMarkup], { type: "image/svg+xml;charset=utf-8" });
            downloadBlob(blob, getFilename("svg"));
            if (tools && typeof tools.notifySuccess === "function") {
                tools.notifySuccess("Downloaded", "SVG QR code downloaded.");
            }
        },

        async downloadRaster(format) {
            if (!this.canDownload) {
                return;
            }

            const normalizedFormat = format === "jpg" ? "jpg" : "png";
            const mimeType = normalizedFormat === "jpg" ? "image/jpeg" : "image/png";

            try {
                const image = await renderSvgToImage(this.svgMarkup);
                const canvas = document.createElement("canvas");
                canvas.width = this.rasterSize;
                canvas.height = this.rasterSize;

                const context = canvas.getContext("2d");
                if (!context) {
                    throw new Error("Canvas is not available.");
                }

                context.fillStyle = this.backgroundColor;
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.imageSmoothingEnabled = false;
                context.drawImage(image, 0, 0, canvas.width, canvas.height);

                const blob = await new Promise((resolve, reject) => {
                    canvas.toBlob((result) => {
                        if (result) {
                            resolve(result);
                            return;
                        }

                        reject(new Error("The browser could not create the raster file."));
                    }, mimeType, 0.92);
                });

                downloadBlob(blob, getFilename(normalizedFormat));
                if (tools && typeof tools.notifySuccess === "function") {
                    tools.notifySuccess("Downloaded", `${normalizedFormat.toUpperCase()} QR code downloaded.`);
                }
            }
            catch (error) {
                this.error = error && error.message ? error.message : "Could not export raster image.";
                this.status = "Export error.";
                if (tools && typeof tools.notifyError === "function") {
                    tools.notifyError("Export failed", this.error);
                }
            }
        }
    }));
});
