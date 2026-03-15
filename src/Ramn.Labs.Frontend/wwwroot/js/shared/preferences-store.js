(() => {
    const themeStorageKey = "ramnlabs.georaptor.theme";
    const mapMaximizedStorageKey = "ramnlabs.maps.maximized";
    const defaultTheme = "system";

    function safeRead(key) {
        try {
            return window.localStorage.getItem(key);
        }
        catch {
            return null;
        }
    }

    function safeWrite(key, value) {
        try {
            window.localStorage.setItem(key, value);
        }
        catch {
            // Ignore storage write failures to keep UX functional in restricted browsers.
        }
    }

    function resolveAppliedTheme(theme) {
        if (theme === "light" || theme === "dark") {
            return theme;
        }

        const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
        return prefersDark ? "dark" : "light";
    }

    function applyTheme(theme) {
        const applied = resolveAppliedTheme(theme);
        document.documentElement.setAttribute("data-bs-theme", applied);
        return applied;
    }

    function getTheme() {
        return safeRead(themeStorageKey) ?? defaultTheme;
    }

    function setTheme(theme) {
        safeWrite(themeStorageKey, theme);
        return applyTheme(theme);
    }

    function getPreference(key, fallbackValue) {
        const raw = safeRead(key);
        if (raw === null) {
            return fallbackValue;
        }

        try {
            return JSON.parse(raw);
        }
        catch {
            return fallbackValue;
        }
    }

    function setPreference(key, value) {
        safeWrite(key, JSON.stringify(value));
    }

    function getMapMaximizedPreference() {
        return safeRead(mapMaximizedStorageKey) === "1";
    }

    function setMapMaximizedPreference(isMaximized) {
        safeWrite(mapMaximizedStorageKey, isMaximized ? "1" : "0");
    }

    window.preferencesStore = {
        themeStorageKey,
        mapMaximizedStorageKey,
        defaultTheme,
        getTheme,
        setTheme,
        applyTheme,
        resolveAppliedTheme,
        getPreference,
        setPreference,
        getMapMaximizedPreference,
        setMapMaximizedPreference
    };
})();
