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

// admin views and actions

function loadPendingItems() {
  const token = localStorage.getItem("token");

  $.ajax({
    url: window.location.origin + "/admin/items/pending",
    method: "GET",
    headers: {
      Authorization: "Bearer " + token,
    },
    success: function (items) {
      let rows = "";

      if (items.length === 0) {
        rows =
          "<tr><td colspan='6' class='text-center'>No pending items</td></tr>";
      }

      items.forEach((item) => {
        rows += `
          <tr>
            <td>
              <a href="item-details.html?id=${item.id}">
                ${item.title}
              </a>
            </td>
            <td>${item.item_type}</td>
            <td>${item.category}</td>
            <td>${item.location}</td>
            <td>${item.reported_by}</td>
            <td>
              <button class="btn btn-success btn-sm verifyItem" data-id="${item.id}">
                Verify
              </button>
              <button class="btn btn-danger btn-sm rejectItem" data-id="${item.id}">
                Reject
              </button>
            </td>
          </tr>
        `;
      });

      $("#pendingItemsTable").html(rows);
    },
    error: function () {
      $("#pendingItemsTable").html(
        "<tr><td colspan='6'>Failed to load items</td></tr>",
      );
    },
  });
}

$(document).on("click", ".verifyItem", function () {
  handleVerification($(this).data("id"), "verified");
});

$(document).on("click", ".rejectItem", function () {
  handleVerification($(this).data("id"), "rejected");
});

function handleVerification(itemId, action) {
  const token = localStorage.getItem("token");

  if (!confirm(`Are you sure you want to ${action} this item?`)) return;

  $.ajax({
    url: window.location.origin + "/admin/items/verify",
    method: "POST",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + token,
    },
    data: JSON.stringify({
      item_id: itemId,
      action: action,
    }),
    success: function (res) {
      alert(res.message);
      loadPendingItems();
    },
    error: function () {
      alert("Action failed");
    },
  });
}

$(document).on("click", ".verifyItem", function () {
  handleVerification($(this).data("id"), "verified");
});

$(document).on("click", ".rejectItem", function () {
  handleVerification($(this).data("id"), "rejected");
});

function handleVerification(itemId, action) {
  const token = localStorage.getItem("token");

  if (!confirm(`Are you sure you want to ${action} this item?`)) return;

  $.ajax({
    url: window.location.origin + "/admin/items/verify",
    method: "POST",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + token,
    },
    data: JSON.stringify({
      item_id: itemId,
      action: action,
    }),
    success: function (res) {
      alert(res.message);
      loadPendingItems();
    },
    error: function () {
      alert("Action failed");
    },
  });
}

function loadReportedItems() {
  const token = localStorage.getItem("token");

  $.ajax({
    url: window.location.origin + "/admin/reported-items",
    method: "GET",
    headers: {
      Authorization: "Bearer " + token,
    },
    success: function (reports) {
      let rows = "";

      if (reports.length === 0) {
        rows =
          "<tr><td colspan='8' class='text-center'>No reported items</td></tr>";
      }

      reports.forEach((report) => {
        rows += `
          <tr>
            <td>
              <a href="item-details.html?id=${report.item_id}">
                ${report.title}
              </a>
            </td>
            <td>${report.item_owner}</td>
            <td>${report.reported_by}</td>
            <td>${report.reason}</td>
            <td>${report.description || "-"}</td>
            <td>${report.status}</td>
            <td>
              <button class="btn btn-danger btn-sm deleteReportedItem"
                data-report="${report.report_id}">
                Delete Item
              </button>
              <button class="btn btn-secondary btn-sm ignoreReport"
                data-report="${report.report_id}">
                Ignore
              </button>
            </td>
          </tr>
        `;
      });

      $("#reportedItemsTable").html(rows);
    },
    error: function () {
      $("#reportedItemsTable").html(
        "<tr><td colspan='8'>Failed to load reports</td></tr>",
      );
    },
  });
}

$(document).on("click", ".deleteReportedItem", function () {
  handleReportAction($(this).data("report"), "delete");
});

$(document).on("click", ".ignoreReport", function () {
  handleReportAction($(this).data("report"), "ignore");
});

function handleReportAction(reportId, action) {
  const token = localStorage.getItem("token");

  const note = prompt("Optional admin note:");

  if (!confirm(`Confirm ${action} action?`)) return;

  $.ajax({
    url: window.location.origin + "/admin/reports/action",
    method: "POST",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + token,
    },
    data: JSON.stringify({
      report_id: reportId,
      action: action,
      admin_note: note,
    }),
    success: function (res) {
      alert(res.message);
      loadReportedItems();
    },
    error: function () {
      alert("Action failed");
    },
  });
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

function loadAdminStats() {
  const token = localStorage.getItem("token");

  $.ajax({
    url: window.location.origin + "/admin/stats",
    method: "GET",
    headers: { Authorization: "Bearer " + token },
    success: function (stats) {
      $("#dashboardContent").html(`
        <h3>Admin Dashboard</h3>

        <div class="row mt-4">
          <div class="col-md-3">
            <div class="card p-3 text-center shadow">
              <h4>${stats.total_items}</h4>
              <small>Total Items</small>
            </div>
          </div>

          <div class="col-md-3">
            <div class="card p-3 text-center shadow">
              <h4>${stats.pending_items}</h4>
              <small>Pending Verification</small>
            </div>
          </div>

          <div class="col-md-3">
            <div class="card p-3 text-center shadow">
              <h4>${stats.reports}</h4>
              <small>Reports</small>
            </div>
          </div>

          <div class="col-md-3">
            <div class="card p-3 text-center shadow">
              <h4>${stats.users}</h4>
              <small>Users</small>
            </div>
          </div>
        </div>
      `);
    },
  });
}

function loadLogs() {
  const token = localStorage.getItem("token");

  $.ajax({
    url: window.location.origin + "/admin/logs",
    method: "GET",
    headers: { Authorization: "Bearer " + token },
    success: function (logs) {
      let rows = "";

      logs.forEach((log) => {
        rows += `
          <tr>
            <td>${log.admin_name}</td>
            <td>${log.action_type}</td>
            <td>${log.target_type}</td>
            <td>${log.target_id}</td>
            <td>${log.details || "-"}</td>
            <td>${new Date(log.created_at).toLocaleString()}</td>
          </tr>
        `;
      });

      $("#logsTable").html(rows);
    },
  });
}

function loadUsers() {
  const token = localStorage.getItem("token");

  $.ajax({
    url: window.location.origin + "/admin/users",
    method: "GET",
    headers: { Authorization: "Bearer " + token },
    success: function (users) {
      let rows = "";

      users.forEach((u) => {
        rows += `
          <tr>
            <td>${u.full_name}</td>
            <td>${u.email}</td>
            <td>${u.role}</td>
            <td>${new Date(u.created_at).toLocaleDateString()}</td>
            <td>
              <button class="btn btn-danger btn-sm deleteUser" data-id="${u.id}">
                Delete
              </button>
            </td>
          </tr>
        `;
      });

      $("#usersTable").html(rows);
    },
  });
}

$(document).on("click", ".deleteUser", function () {
  const token = localStorage.getItem("token");
  const id = $(this).data("id");

  if (!confirm("Delete this user?")) return;

  $.ajax({
    url: window.location.origin + "/admin/users/" + id,
    method: "DELETE",
    headers: { Authorization: "Bearer " + token },
    success: function () {
      loadUsers();
    },
  });
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
      loadAdminStats();
      return;
    }

    // Other pages remain dynamic
    if (page === "verify-items") {
      $("#dashboardContent").html(`
    <h3>Pending Items</h3>
    <div class="card p-3 mt-3">
      <table class="table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Type</th>
            <th>Category</th>
            <th>Location</th>
            <th>Reported By</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="pendingItemsTable"></tbody>
      </table>
    </div>
  `);

      loadPendingItems();
    }

    if (page === "reported-items") {
      $("#dashboardContent").html(`
    <h3>Reported Items</h3>
    <div class="card p-3 mt-3">
      <table class="table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Owner</th>
            <th>Reported By</th>
            <th>Reason</th>
            <th>Description</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="reportedItemsTable"></tbody>
      </table>
    </div>
  `);

      loadReportedItems();
    }

    if (page === "users") {
      $("#dashboardContent").html(`
    <h3>Users</h3>
    <div class="card p-3 mt-3">
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Joined</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody id="usersTable"></tbody>
      </table>
    </div>
  `);

      loadUsers();
    }

    if (page === "logs") {
      $("#dashboardContent").html(`
    <h3>Admin Logs</h3>
    <div class="card p-3 mt-3">
      <table class="table">
        <thead>
          <tr>
            <th>Admin</th>
            <th>Action</th>
            <th>Target</th>
            <th>ID</th>
            <th>Details</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody id="logsTable"></tbody>
      </table>
    </div>
  `);

      loadLogs();
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
