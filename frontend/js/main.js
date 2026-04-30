$(document).ready(function () {
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
      alert("Please login first");
      window.location.href = "login.html";
      return;
    }

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

      success: function () {
        window.location.href = "success.html";
      },

      error: function (err) {
        alert(err.responseJSON?.message || "Upload failed");
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
    alert("Passwords do not match");
    return;
  }

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
      alert(err.responseJSON?.message || "Signup failed");
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
      alert(err.responseJSON?.message || "Login failed");
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
