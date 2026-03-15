(() => {
    const themeStorageKey = "ramnlabs.georaptor.theme";
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

    window.preferencesStore = {
        themeStorageKey,
        defaultTheme,
        getTheme,
        setTheme,
        applyTheme,
        resolveAppliedTheme
    };
})();
