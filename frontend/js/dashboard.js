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
        <div class="card p-3 mt-3">User items placeholder</div>
      `);
    }

    if (page === "profile") {
      $("#dashboardContent").html(`
        <h3>Profile</h3>
        <div class="card p-3 mt-3">Profile placeholder</div>
     `);
    }
  });
});
