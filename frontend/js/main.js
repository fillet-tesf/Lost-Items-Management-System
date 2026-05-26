function showToastMessage(message, type = "info") {
  if (window.LIMS_UI && window.LIMS_UI.showToast) {
    window.LIMS_UI.showToast(message, type);
    return;
  }
  console.log(message);
}

function lockSubmitButton($form, label) {
  const $button = $form.find('button[type="submit"]').first();
  if (!$button.length) {
    return function noop() {};
  }

  if (window.LIMS_UI && window.LIMS_UI.setButtonLoading) {
    return window.LIMS_UI.setButtonLoading($button, label);
  }

  const originalText = $button.text();
  $button.prop("disabled", true).text(label || "Processing...");
  return function restore() {
    $button.prop("disabled", false).text(originalText);
  };
}

function persistUserCoins(nextCoins) {
  if (!Number.isFinite(Number(nextCoins))) return;
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  if (!Object.keys(user).length) return;
  user.coins = Number(nextCoins);
  localStorage.setItem("user", JSON.stringify(user));
}

function loadSelectOptions(endpoint, selector, placeholder) {
  const $select = $(selector);
  if (!$select.length) return;

  $.get(window.location.origin + endpoint)
    .done((rows) => {
      const options = (rows || [])
        .map(
          (row) =>
            `<option value="${row.id}">${window.LIMS_UI && window.LIMS_UI.escapeHtml ? window.LIMS_UI.escapeHtml(row.name) : row.name}</option>`,
        )
        .join("");
      $select.html(
        `<option value="">${placeholder}</option>${options}`,
      );
    })
    .fail(() => {
      showToastMessage(`Failed to load ${placeholder.toLowerCase()} list`, "error");
    });
}

function applyUploadAuthGate() {
  const $form = $("#uploadForm");
  if (!$form.length) return;

  const token = localStorage.getItem("token");
  const interactiveSelector = "input, select, textarea, button";

  if (token) {
    $form.find(interactiveSelector).prop("disabled", false);
    $("#uploadAuthNotice").remove();
    return;
  }

  $form.find(interactiveSelector).prop("disabled", true);
  if ($("#uploadAuthNotice").length === 0) {
    $form.before(`
      <div id="uploadAuthNotice" class="alert alert-warning d-flex align-items-start gap-2 mb-4">
        <i class="bi bi-lock-fill mt-1"></i>
        <div>
          <strong>Login required.</strong> You need to <a href="login.html" class="alert-link">sign in</a> before reporting a lost or found item.
        </div>
      </div>
    `);
  }
}

$(document).ready(function () {
  if ($("#uploadForm").length) {
    loadSelectOptions("/categories", "#category", "Select category");
    loadSelectOptions("/locations", "#location", "Select location");
    applyUploadAuthGate();
  }

  // -------- SUBMIT VALIDATION FOR UPLOAD PAGE--------
  $("#uploadForm").on("submit", function (e) {
    e.preventDefault();
    e.stopPropagation();

    let isValid = true;

    function checkField(selector) {
      if ($(selector).val().trim() === "") {
        $(selector).addClass("is-invalid");
        isValid = false;
      } else {
        $(selector).removeClass("is-invalid");
      }
    }

    checkField("#itemType");
    checkField("#itemName");
    checkField("#category");
    checkField("#location");
    checkField("#date");
    checkField("#description");

    if (!isValid) return;

    const token = localStorage.getItem("token");

    if (!token) {
      showToastMessage("Please login first", "warning");
      return;
    }

    const restoreUploadButton = lockSubmitButton($(this), "Submitting...");

    const formData = new FormData();

    const itemType = $("#itemType").val();
    const title = $("#itemName").val();
    const description = $("#description").val();
    const category_id = $("#category").val();
    const location_id = $("#location").val();
    const date = $("#date").val();
    const image = $("#image")[0]?.files[0];

    formData.append("item_type", itemType);
    formData.append("title", title);
    formData.append("description", description);
    formData.append("category_id", category_id);
    formData.append("location_id", location_id);

    if (itemType === "lost") {
      formData.append("lost_date", date);
    } else {
      formData.append("found_date", date);
    }

    if (image) {
      formData.append("image", image);
    }

    $.ajax({
      url: window.location.origin + "/items",
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
      },
      processData: false,
      contentType: false,
      //cache: false,
      data: formData,

      success: function (response) {
        if (typeof response?.current_balance !== "undefined") {
          persistUserCoins(response.current_balance);
        }
        window.location.href = "success.html";
      },

      error: function (err) {
        showToastMessage(err.responseJSON?.message || "Upload failed", "error");
      },
      complete: function () {
        restoreUploadButton();
      },
    });
    return false;
  });

  // -------- LIVE ERROR REMOVAL --------

  // Text inputs & textarea
  $("#itemName, #location, #date, #description").on("input", function () {
    if ($(this).val().trim() !== "") {
      $(this).removeClass("is-invalid");
    }
  });

  // Select dropdowns
  $("#itemType, #category, #location").on("change", function () {
    if ($(this).val() !== "") {
      $(this).removeClass("is-invalid");
    }
  });
});

// -------- SUBMIT VALIDATION FOR SIGN UP PAGE--------

$("#signUpForm").on("submit", function (e) {
  e.preventDefault();

  let isValid = true;

  function checkField(selector) {
    if ($(selector).val().trim() === "") {
      $(selector).addClass("is-invalid");
      isValid = false;
    } else {
      $(selector).removeClass("is-invalid");
    }
  }

  checkField("#fullName");
  checkField("#email");
  checkField("#phone");
  checkField("#password");
  checkField("#confirmPassword");

  if (!isValid) return;

  if ($("#password").val() !== $("#confirmPassword").val()) {
    showToastMessage("Passwords do not match", "warning");
    return;
  }

  const restoreSignupButton = lockSubmitButton($(this), "Creating account...");

  const userData = {
    fullName: $("#fullName").val(),
    email: $("#email").val(),
    phone: $("#phone").val(),
    password: $("#password").val(),
  };

  $.ajax({
    url: window.location.origin + "/signup",
    method: "POST",
    contentType: "application/json",
    data: JSON.stringify(userData),

    success: function () {
      window.location.href = "signup-success.html";
    },

    error: function (err) {
      showToastMessage(err.responseJSON?.message || "Signup failed", "error");
    },
    complete: function () {
      restoreSignupButton();
    },
  });
});

// -------- LIVE ERROR REMOVAL --------

// Text inputs & textarea
$("#fullName, #email, #phone, #password, #confirmPassword").on(
  "input",
  function () {
    if ($(this).val().trim() !== "") {
      $(this).removeClass("is-invalid");
    }
  },
);

// -------- SUBMIT VALIDATION FOR LOG IN PAGE--------

$("#loginForm").on("submit", function (e) {
  e.preventDefault();

  let isValid = true;

  function checkField(selector) {
    if ($(selector).val().trim() === "") {
      $(selector).addClass("is-invalid");
      isValid = false;
    } else {
      $(selector).removeClass("is-invalid");
    }
  }

  checkField("#loginEmailOrPhone");
  checkField("#loginPassword");

  if (!isValid) return;

  const restoreLoginButton = lockSubmitButton($(this), "Signing in...");

  const email = $("#loginEmailOrPhone").val();
  const password = $("#loginPassword").val();

  $.ajax({
    url: window.location.origin + "/login",
    method: "POST",
    contentType: "application/json",
    data: JSON.stringify({ email, password }),

    success: function (response) {
      // Save JWT
      localStorage.setItem("token", response.token);
      localStorage.setItem("user", JSON.stringify(response.user));

      window.location.href = "index.html";
    },

    error: function (err) {
      showToastMessage(err.responseJSON?.message || "Login failed", "error");
    },
    complete: function () {
      restoreLoginButton();
    },
  });
});

// -------- LIVE ERROR REMOVAL --------

// Text inputs & textarea
$("#loginEmailOrPhone, #loginPassword").on("input", function () {
  if ($(this).val().trim() !== "") {
    $(this).removeClass("is-invalid");
  }
});
