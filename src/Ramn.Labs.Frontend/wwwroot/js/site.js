document.addEventListener("alpine:init", () => {
	Alpine.data("themeController", () => ({
		theme: "system",

		init() {
			this.theme = window.preferencesStore.getTheme();
			this.apply();
		},

		apply() {
			window.preferencesStore.setTheme(this.theme);
		}
	}));
});

(function () {
	const toastClassByLevel = {
		success: "text-bg-success",
		error: "text-bg-danger",
		warning: "text-bg-warning",
		info: "text-bg-primary"
	};

	let lastBackendConnectionToastAt = 0;
	const backendConnectionToastCooldownMs = 10_000;

	function getToastContainer() {
		let container = document.getElementById("appToastContainer");
		if (container) {
			return container;
		}

		container = document.createElement("div");
		container.id = "appToastContainer";
		container.className = "toast-container position-fixed top-0 end-0 p-3";
		container.setAttribute("aria-live", "polite");
		container.setAttribute("aria-atomic", "true");
		document.body.appendChild(container);
		return container;
	}

	function showToast(level, title, message, delay) {
		if (typeof bootstrap === "undefined" || !bootstrap.Toast) {
			return;
		}

		const container = getToastContainer();
		const toastElement = document.createElement("div");
		toastElement.className = `toast align-items-center border-0 ${toastClassByLevel[level] || toastClassByLevel.info}`;
		toastElement.setAttribute("role", "status");
		toastElement.setAttribute("aria-live", "polite");
		toastElement.setAttribute("aria-atomic", "true");

		const body = document.createElement("div");
		body.className = "d-flex";

		const content = document.createElement("div");
		content.className = "toast-body";
		const strongTitle = title ? `<strong>${title}</strong><br />` : "";
		content.innerHTML = `${strongTitle}${message}`;

		const closeButton = document.createElement("button");
		closeButton.type = "button";
		closeButton.className = "btn-close btn-close-white me-2 m-auto";
		closeButton.setAttribute("data-bs-dismiss", "toast");
		closeButton.setAttribute("aria-label", "Close");

		body.appendChild(content);
		body.appendChild(closeButton);
		toastElement.appendChild(body);
		container.appendChild(toastElement);

		const toast = bootstrap.Toast.getOrCreateInstance(toastElement, {
			delay: Number.isFinite(delay) ? delay : 5000,
			autohide: true
		});

		toastElement.addEventListener("hidden.bs.toast", () => {
			toastElement.remove();
		});

		toast.show();
	}

	function showBackendConnectionErrorToast() {
		const now = Date.now();
		if (now - lastBackendConnectionToastAt < backendConnectionToastCooldownMs) {
			return;
		}

		lastBackendConnectionToastAt = now;
		showToast("error", "Connection lost", "Cannot reach backend right now. Please ensure the backend is running and reachable.", 7000);
	}

	window.appNotifications = {
		success(title, message, delay) {
			showToast("success", title, message, delay);
		},
		error(title, message, delay) {
			showToast("error", title, message, delay);
		},
		warning(title, message, delay) {
			showToast("warning", title, message, delay);
		},
		info(title, message, delay) {
			showToast("info", title, message, delay);
		},
		backendConnectionError() {
			showBackendConnectionErrorToast();
		}
	};
})();
