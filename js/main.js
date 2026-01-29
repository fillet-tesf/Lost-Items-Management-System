$(document).ready(function () {
  // -------- SUBMIT VALIDATION FOR UPLOAD PAGE--------
  $("#uploadForm").on("submit", function (e) {
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

    checkField("#itemType");
    checkField("#itemName");
    checkField("#category");
    checkField("#location");
    checkField("#date");
    checkField("#description");

    if (isValid) {
      const type = $("#itemType").val();
      window.location.href = "success.html?type=" + type;
    }
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

  if (isValid) {
    const type = $("#fullName").val();
    window.location.href = "signup-success.html?type=" + type;
  }
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
  if (isValid) {
    const type = $("#loginEmailOrPhone").val();
    window.location.href = "index.html";
  }
});

// -------- LIVE ERROR REMOVAL --------

// Text inputs & textarea
$("#loginEmailOrPhone, #loginPassword").on("input", function () {
  if ($(this).val().trim() !== "") {
    $(this).removeClass("is-invalid");
  }
});
