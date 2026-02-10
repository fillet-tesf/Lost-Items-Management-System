$(document).ready(function () {
  const token = localStorage.getItem("token");
  const user = JSON.parse(localStorage.getItem("user"));

  // If not logged in → go back to login
  if (!token || !user) {
    window.location.href = "login.html";
    return;
  }

  // Show user name in dashboard if element exists
  if ($("#welcomeName").length) {
    $("#welcomeName").text(user.full_name);
  }
});

function loadMyItems() {
  const token = localStorage.getItem("token");

  $.ajax({
    url: window.location.origin + "/my-items",
    method: "GET",
    headers: {
      Authorization: "Bearer " + token,
    },
    success: function (items) {
      let rows = "";

      items.forEach((item) => {
        rows += `
          <tr>
            <td>${item.title}</td>
            <td>${item.category}</td>
            <td>${item.location}</td>
            <td>
              <span class="badge bg-secondary">${item.status}</span>
            </td>
            <td>
              <button
                class="btn btn-sm btn-warning editItem"
                data-id="${item.id}"
              >
                Edit
              </button>
              <button
                class="btn btn-sm btn-danger deleteItem"
                data-id="${item.id}"
              >
                Delete
              </button>
            </td>
          </tr>`;
      });

      $("#myItemsTable").html(rows);
    },
    error: function () {
      $("#myItemsTable").html(
        "<tr><td colspan='5'>Failed to load items</td></tr>",
      );
    },
  });
}

function loadProfile() {
  const token = localStorage.getItem("token");

  fetch(window.location.origin + "/profile", {
    headers: {
      Authorization: "Bearer " + token,
    },
  })
    .then((res) => res.json())
    .then((user) => {
      $("#profileName").text(user.name);
      $("#profileEmail").text(user.email);
      $("#profileRole").text(user.role);
      $("#profileDate").text(new Date(user.created_at).toLocaleDateString());
    })
    .catch((err) => console.log(err));
}

$(document).on("click", ".deleteItem", function () {
  const token = localStorage.getItem("token");
  const itemId = $(this).data("id");

  if (!confirm("Delete this item?")) return;

  $.ajax({
    url: window.location.origin + "/items/" + itemId,
    method: "DELETE",
    headers: {
      Authorization: "Bearer " + token,
    },
    success: function () {
      alert("Item deleted");
      loadMyItems();
    },
    error: function () {
      alert("Delete failed");
    },
  });
});

$(document).on("click", ".editItem", function () {
  const id = $(this).data("id");
  window.location.href = "edit-item.html?id=" + id;
});

$(document).ready(function () {
  $(".sidebar .nav-link").click(function (e) {
    e.preventDefault();

    $(".sidebar .nav-link").removeClass("active");
    $(this).addClass("active");

    const page = $(this).data("page");

    // Dashboard should reload the page (home state)
    if (page === "admin-overview" || page === "user-overview") {
      location.reload();
      return;
    }

    // Other pages remain dynamic
    if (page === "verify-items") {
      $("#dashboardContent").html(`
        <h3>Verify Items</h3>
        <div class="card p-3 mt-3">Items awaiting admin verification</div>
      `);
    }

    if (page === "reported-items") {
      $("#dashboardContent").html(`
        <h3>Reported Items</h3>
        <div class="card p-3 mt-3">Reported items list placeholder</div>
      `);
    }

    if (page === "users") {
      $("#dashboardContent").html(`
        <h3>Users</h3>
        <div class="card p-3 mt-3">Users list placeholder</div>
      `);
    }

    if (page === "logs") {
      $("#dashboardContent").html(`
        <h3>Admin Logs</h3>
        <div class="card p-3 mt-3">System logs placeholder</div>
      `);
    }

    if (page === "my-items") {
      $("#dashboardContent").html(`
    <h3>My Items</h3>
    <div class="card p-3 mt-3">
      <table class="table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Category</th>
            <th>Location</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="myItemsTable"></tbody>
      </table>
    </div>
   `);

      loadMyItems();
    }
    if (page === "profile") {
      $("#dashboardContent").html(`
        <div class="container mt-3">
          <h3 class="mb-4">My Profile</h3>

          <div class="card shadow-sm">
            <div class="card-body">
              <h5 id="profileName"></h5>
              <p class="mb-1">
                <strong>Email:</strong> <span id="profileEmail"></span>
              </p>
              <p class="mb-1">
                <strong>Role:</strong> <span id="profileRole"></span>
              </p>
              <p class="mb-1">
                <strong>Joined:</strong> <span id="profileDate"></span>
              </p>
            </div>
          </div>
        </div> `);

      loadProfile();
    }
  });
});
