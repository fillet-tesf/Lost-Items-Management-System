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

function isValidEmail(value) {
  const email = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidEthiopianPhone(value) {
  const phone = String(value || "").trim();
  return /^(?:\+251[79]\d{8}|0[79]\d{8})$/.test(phone);
}

function isStrongPassword(value) {
  const password = String(value || "");
  if (password.length < 6) return false;
  return /[A-Za-z]/.test(password) && /\d/.test(password);
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

  if (!$("#agreeTerms").is(":checked")) {
    showToastMessage(
      "You must agree to the Privacy Policy and Terms of Service",
      "warning",
    );
    return;
  }

  if ($("#password").val() !== $("#confirmPassword").val()) {
    showToastMessage("Passwords do not match", "warning");
    return;
  }

  if (!isValidEmail($("#email").val())) {
    showToastMessage("Enter a valid email address (example: user@gmail.com)", "warning");
    $("#email").addClass("is-invalid").focus();
    return;
  }

  if (!isValidEthiopianPhone($("#phone").val())) {
    showToastMessage(
      "Enter a valid Ethiopian phone number: 09XXXXXXXX, 07XXXXXXXX, +2519XXXXXXXX, or +2517XXXXXXXX",
      "warning",
    );
    $("#phone").addClass("is-invalid").focus();
    return;
  }

  if (!isStrongPassword($("#password").val())) {
    showToastMessage(
      "Password must be at least 6 characters and include at least one letter and one number",
      "warning",
    );
    $("#password").addClass("is-invalid").focus();
    return;
  }

  const restoreSignupButton = lockSubmitButton($(this), "Creating account...");

  const userData = {
    fullName: $("#fullName").val(),
    email: $("#email").val(),
    phone: $("#phone").val(),
    password: $("#password").val(),
    agreedToTerms: $("#agreeTerms").is(":checked"),
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

$("#agreeTerms").on("change", function () {
  $("#signUpButton").prop("disabled", !$(this).is(":checked"));
});

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

$("#forgotPasswordForm").on("submit", function (e) {
  e.preventDefault();

  const email = $("#forgotPasswordEmail").val().trim();
  if (!email) {
    $("#forgotPasswordEmail").addClass("is-invalid");
    return;
  }

  if (!isValidEmail(email)) {
    showToastMessage("Enter a valid email address", "warning");
    $("#forgotPasswordEmail").addClass("is-invalid").focus();
    return;
  }

  const restoreButton = lockSubmitButton($(this), "Sending...");
  $.ajax({
    url: window.location.origin + "/forgot-password",
    method: "POST",
    contentType: "application/json",
    data: JSON.stringify({ email }),
    success(response) {
      showToastMessage(response.message, "success");
      $("#forgotPasswordEmail").val("");
    },
    error(err) {
      showToastMessage(
        err.responseJSON?.message || "Failed to send reset link",
        "error",
      );
    },
    complete() {
      restoreButton();
    },
  });
});

$("#forgotPasswordEmail").on("input", function () {
  if ($(this).val().trim() !== "") {
    $(this).removeClass("is-invalid");
  }
});

function initializeResetPasswordPage() {
  const $form = $("#resetPasswordForm");
  if (!$form.length) return;

  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  $("#resetPasswordToken").val(token);

  if (!token) {
    $("#resetPasswordHelpText").text("This reset link is missing or invalid.");
    $form.find("input, button").prop("disabled", true);
    return;
  }

  $.get(window.location.origin + "/reset-password/validate?token=" + encodeURIComponent(token))
    .fail((xhr) => {
      $("#resetPasswordHelpText").text(
        xhr.responseJSON?.message || "This reset link is invalid or expired.",
      );
      $form.find("input, button").prop("disabled", true);
    });
}

$("#resetPasswordForm").on("submit", function (e) {
  e.preventDefault();

  const token = $("#resetPasswordToken").val().trim();
  const newPassword = $("#resetPasswordNew").val();
  const confirmPassword = $("#resetPasswordConfirm").val();

  if (!newPassword || !confirmPassword) {
    showToastMessage("Fill in both password fields", "warning");
    return;
  }

  if (newPassword !== confirmPassword) {
    showToastMessage("Passwords do not match", "warning");
    return;
  }

  if (!isStrongPassword(newPassword)) {
    showToastMessage(
      "Password must be at least 6 characters and include at least one letter and one number",
      "warning",
    );
    return;
  }

  const restoreButton = lockSubmitButton($(this), "Resetting...");
  $.ajax({
    url: window.location.origin + "/reset-password",
    method: "POST",
    contentType: "application/json",
    data: JSON.stringify({
      token,
      new_password: newPassword,
      confirm_password: confirmPassword,
    }),
    success(response) {
      showToastMessage(response.message, "success");
      setTimeout(() => {
        window.location.href = "login.html";
      }, 1200);
    },
    error(err) {
      showToastMessage(
        err.responseJSON?.message || "Failed to reset password",
        "error",
      );
    },
    complete() {
      restoreButton();
    },
  });
});

$(document).ready(function () {
  initializeResetPasswordPage();
});
