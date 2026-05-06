(function initLimsUi(window, $) {
  if (!window || !$) return;

  function ensureUiShell() {
    if ($("#limsToastContainer").length === 0) {
      $("body").append(`
        <div id="limsToastContainer" class="toast-container position-fixed top-0 end-0 p-3" style="z-index: 1080;"></div>
      `);
    }

    if ($("#limsConfirmModal").length === 0) {
      $("body").append(`
        <div class="modal fade" id="limsConfirmModal" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title" id="limsConfirmTitle">Please Confirm</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
              </div>
              <div class="modal-body" id="limsConfirmMessage"></div>
              <div class="modal-footer">
                <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
                <button type="button" class="btn btn-primary" id="limsConfirmAction">Confirm</button>
              </div>
            </div>
          </div>
        </div>
      `);
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function showToast(message, type) {
    ensureUiShell();
    const tone = type || "success";
    const styleMap = {
      success: "text-bg-success",
      error: "text-bg-danger",
      warning: "text-bg-warning",
      info: "text-bg-primary",
    };

    const cssClass = styleMap[tone] || styleMap.info;
    const toastId = `toast-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const toastHtml = `
      <div id="${toastId}" class="toast align-items-center ${cssClass} border-0 mb-2" role="status" aria-live="polite" aria-atomic="true">
        <div class="d-flex">
          <div class="toast-body">${escapeHtml(message)}</div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
      </div>
    `;

    $("#limsToastContainer").append(toastHtml);
    const el = document.getElementById(toastId);
    const instance = new bootstrap.Toast(el, { delay: 3200 });
    el.addEventListener("hidden.bs.toast", function () {
      $(el).remove();
    });
    instance.show();
  }

  function showConfirm(options) {
    ensureUiShell();

    const settings = Object.assign(
      {
        title: "Please Confirm",
        message: "Are you sure you want to continue?",
        confirmText: "Confirm",
        confirmVariant: "primary",
      },
      options || {},
    );

    $("#limsConfirmTitle").text(settings.title);
    $("#limsConfirmMessage").text(settings.message);
    $("#limsConfirmAction")
      .text(settings.confirmText)
      .attr(
        "class",
        `btn btn-${settings.confirmVariant || "primary"}`,
      );

    return new Promise((resolve) => {
      const modalEl = document.getElementById("limsConfirmModal");
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      let confirmed = false;

      $("#limsConfirmAction")
        .off("click.limsConfirm")
        .on("click.limsConfirm", function () {
          confirmed = true;
          modal.hide();
        });

      $("#limsConfirmModal")
        .off("hidden.bs.modal.limsConfirm")
        .on("hidden.bs.modal.limsConfirm", function () {
          resolve(confirmed);
        });

      modal.show();
    });
  }

  function setButtonLoading($button, loadingText) {
    if (!$button || !$button.length) return function noop() {};
    if ($button.data("loading")) return function noop() {};

    const originalHtml = $button.html();
    const text = loadingText || "Processing...";

    $button.data("loading", true);
    $button.prop("disabled", true);
    $button.html(
      `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>${escapeHtml(text)}`,
    );

    return function restore() {
      $button.prop("disabled", false);
      $button.html(originalHtml);
      $button.removeData("loading");
    };
  }

  function showInlineLoader(selector, message) {
    const text = message || "Loading...";
    $(selector).html(`
      <div class="text-center py-5 text-muted">
        <div class="spinner-border" role="status" aria-hidden="true"></div>
        <div class="mt-2">${escapeHtml(text)}</div>
      </div>
    `);
  }

  function renderStarRating(value, count = 0) {
    const rating = Number(value || 0);
    if (!count) {
      return `<span class="text-muted small">No ratings yet</span>`;
    }
    return `
      <span class="d-inline-flex align-items-center gap-1 small" data-bs-toggle="tooltip" title="${escapeHtml(rating.toFixed(1))} out of 5 based on ${escapeHtml(count)} rating(s).">
        <i class="bi bi-star-fill text-warning"></i>
        <span>${escapeHtml(rating.toFixed(1))}/5</span>
      </span>
    `;
  }

  function renderUserBadges(badges = []) {
    if (!Array.isArray(badges) || !badges.length) return "";
    return badges
      .map((badge) => {
        const color = escapeHtml(badge.color || "secondary");
        const icon = escapeHtml(badge.icon || "bi-award");
        const tooltip = escapeHtml(badge.tooltip || badge.label || "Badge");
        return `
          <span class="d-inline-flex align-items-center justify-content-center ms-1 text-${color}"
            data-bs-toggle="tooltip"
            title="${tooltip}">
            <i class="bi ${icon}"></i>
          </span>
        `;
      })
      .join("");
  }

  function renderUserBadge(user = {}) {
    const name = escapeHtml(user.full_name || user.name || "Unknown user");
    return `
      <span class="d-inline-flex align-items-center flex-wrap gap-1">
        <strong class="text-dark">${name}</strong>
        ${renderStarRating(user.average_rating, Number(user.rating_count || 0))}
        ${renderUserBadges(user.badges || [])}
      </span>
    `;
  }

  window.LIMS_UI = {
    escapeHtml,
    renderStarRating,
    renderUserBadges,
    renderUserBadge,
    showToast,
    showConfirm,
    setButtonLoading,
    showInlineLoader,
  };
})(window, window.jQuery);
