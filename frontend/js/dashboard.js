const token = localStorage.getItem("token");
const user = JSON.parse(localStorage.getItem("user"));

const STATUS_LABELS = {
  proposed: "Possible match",
  confirmed: "Contact requested",
  claimed: "Completed",
  rejected: "Closed",
  pending: "Pending",
  contact_shared: "Contact shared",
  in_progress: "In progress",
  completed: "Completed",
  expired: "Expired",
  verified: "Verified",
};

const STATUS_BADGES = {
  proposed: "warning",
  confirmed: "info",
  claimed: "success",
  rejected: "secondary",
  pending: "warning",
  contact_shared: "primary",
  in_progress: "info",
  completed: "success",
  expired: "dark",
  verified: "success",
};

function notify(message, type = "info") {
  if (window.LIMS_UI && window.LIMS_UI.showToast) {
    window.LIMS_UI.showToast(message, type);
    return;
  }
  console.log(message);
}

async function confirmAction(message, title = "Confirm Action") {
  if (window.LIMS_UI && window.LIMS_UI.showConfirm) {
    return window.LIMS_UI.showConfirm({
      title,
      message,
      confirmText: "Continue",
      confirmVariant: "danger",
    });
  }

  return false;
}

function setActionLoading($button, label = "Processing...") {
  if (!$button || !$button.length) {
    return function noop() {};
  }

  if (window.LIMS_UI && window.LIMS_UI.setButtonLoading) {
    return window.LIMS_UI.setButtonLoading($button, label);
  }

  const originalText = $button.text();
  $button.prop("disabled", true).text(label);
  return function restore() {
    $button.prop("disabled", false).text(originalText);
  };
}

function authHeaders(includeJson = false) {
  const headers = { Authorization: "Bearer " + token };

  if (includeJson) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value) {
  if (!value) return "Not specified";
  return new Date(value).toLocaleDateString();
}

function getStatusBadge(status) {
  const badgeClass = STATUS_BADGES[status] || "secondary";
  const label = STATUS_LABELS[status] || status;
  return `<span class="badge bg-${badgeClass}">${label}</span>`;
}

function getItemDetailsUrl(itemId) {
  return `item-details.html?id=${itemId}`;
}

function getAdminUserUrl(userId) {
  return `admin-user.html?id=${userId}`;
}

function getClaimStatus(match) {
  return match.claim_status || match.match_status;
}

function renderClaimTimeline(match) {
  const steps = [
    { label: "Requested", active: !!match.claim_id },
    { label: "Contact Shared", active: Boolean(match.contact_shared) },
    {
      label: "Offline Handoff",
      active:
        match.claim_status === "in_progress" ||
        match.claim_status === "completed" ||
        Boolean(match.delivered_confirmed) ||
        Boolean(match.received_confirmed),
    },
    { label: "Completed", active: match.claim_status === "completed" },
  ];

  return `
    <div class="d-flex flex-wrap gap-2 mt-3">
      ${steps
        .map(
          (step) => `
            <span class="badge ${step.active ? "bg-success-subtle text-success border" : "bg-light text-muted border"}">
              ${step.label}
            </span>`,
        )
        .join("")}
    </div>
  `;
}

function renderOutgoingClaimActions(match) {
  const claimStatus = getClaimStatus(match);

  if (match.match_status === "proposed" && !match.claim_id) {
    return `
      <button class="btn btn-primary btn-sm requestContact" data-id="${match.id}">This could be mine</button>
      <button class="btn btn-outline-danger btn-sm rejectMatch" data-id="${match.id}">Not my item</button>
    `;
  }

  if (claimStatus === "contact_shared" || claimStatus === "in_progress") {
    return `
      ${!match.received_confirmed ? `<button class="btn btn-success btn-sm confirmReceived" data-id="${match.claim_id}"><i class="bi bi-check2-circle"></i> I received my item</button>` : ""}
      <button class="btn btn-outline-danger btn-sm rejectClaim" data-id="${match.claim_id}" data-label="Not my item">Not my item</button>
      <button class="btn btn-outline-warning btn-sm reportClaimUser" data-id="${match.claim_id}">Report user</button>
    `;
  }

  if (claimStatus === "completed") {
    return `
      <button class="btn btn-outline-primary btn-sm rateClaimUser" data-id="${match.claim_id}" data-target="finder">Rate finder</button>
      <button class="btn btn-outline-warning btn-sm reportClaimUser" data-id="${match.claim_id}">Report user</button>
    `;
  }

  return "";
}

function renderMetricCards(cards) {
  return cards
    .map(
      (card) => `
        <div class="col-md-3">
          <div class="card metric-card border-0 shadow-sm h-100">
            <div class="card-body">
              <div class="metric-label">${escapeHtml(card.label)}</div>
              <div class="metric-value">${escapeHtml(card.value)}</div>
              <div class="metric-note">${escapeHtml(card.note)}</div>
            </div>
          </div>
        </div>`,
    )
    .join("");
}

function notificationActionsMarkup(notification) {
  if (!notification.share_contact_required) {
    return "";
  }

  return `
    <div class="d-flex flex-wrap gap-2 mt-3">
      <button class="btn btn-sm btn-outline-primary shareClaimContact"
        data-id="${notification.claim_id}" data-share-email="1">
        Share Email
      </button>
      <button class="btn btn-sm btn-outline-primary shareClaimContact"
        data-id="${notification.claim_id}" data-share-phone="1">
        Share Phone
      </button>
      <button class="btn btn-sm btn-primary shareClaimContact"
        data-id="${notification.claim_id}" data-share-email="1" data-share-phone="1">
        Share Both
      </button>
      <button class="btn btn-sm btn-outline-danger rejectClaim"
        data-id="${notification.claim_id}" data-label="Not his item">
        Not his item
      </button>
    </div>
  `;
}

function renderUserOverview() {
  $.ajax({
    url: window.location.origin + "/user/dashboard-summary",
    method: "GET",
    headers: authHeaders(),
    success(response) {
      const stats = response.stats || {};
      const recentItems = response.recent_items || [];

      const cards = [
        {
          label: "Total Reports",
          value: stats.total_reported || 0,
          note: "Everything you have submitted",
        },
        {
          label: "Possible Matches",
          value: stats.total_matches || 0,
          note: "Suggestions linked to your lost items",
        },
        {
          label: "Pending Review",
          value: stats.pending_items || 0,
          note: "Items still waiting on verification",
        },
        {
          label: "Unread Notifications",
          value: stats.unread_notifications || 0,
          note: "Match and contact updates",
        },
      ];

      const recentRows = recentItems.length
        ? recentItems
            .map(
              (item) => `
                <tr>
                  <td><a href="${getItemDetailsUrl(item.id)}">${escapeHtml(item.title)}</a></td>
                  <td>${escapeHtml(item.category)}</td>
                  <td>${escapeHtml(item.location)}</td>
                  <td>${getStatusBadge(item.status)}</td>
                </tr>`,
            )
            .join("")
        : "<tr><td colspan='4' class='text-center'>No items reported yet.</td></tr>";

      $("#dashboardContent").html(`
        <div class="d-flex justify-content-between align-items-center flex-wrap gap-3 mb-4">
          <div>
            <h3 class="mb-1">Welcome back, ${escapeHtml(user.full_name)}</h3>
            <p class="text-muted mb-0">Here is the latest summary of your reports, matches, and notifications.</p>
          </div>
          <div class="d-flex gap-2">
            <a href="wallet.html" class="btn btn-outline-secondary">${stats.coins || 0} coins</a>
            <a href="upload.html" class="btn btn-primary">Report New Item</a>
          </div>
        </div>
        <div class="row g-3 mb-4">${renderMetricCards(cards)}</div>
        <div class="card dashboard-panel shadow-sm border-0">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <div>
                <h5 class="mb-1">Recent Items</h5>
                <p class="text-muted mb-0">Your latest submissions and their current status.</p>
              </div>
              <a href="#" class="btn btn-sm btn-outline-secondary dashboardShortcut" data-page="my-items">Open My Items</a>
            </div>
            <div class="table-responsive">
              <table class="table align-middle mb-0">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Category</th>
                    <th>Location</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>${recentRows}</tbody>
              </table>
            </div>
          </div>
        </div>
      `);
    },
    error() {
      $("#dashboardContent").html(
        '<div class="alert alert-danger">Failed to load your dashboard summary.</div>',
      );
    },
  });
}

function renderAdminOverview() {
  $.ajax({
    url: window.location.origin + "/admin/stats",
    method: "GET",
    headers: authHeaders(),
    success(stats) {
      const cards = [
        {
          label: "Total Users",
          value: stats.total_users || 0,
          note: "Registered normal users",
        },
        {
          label: "Pending Reports",
          value: stats.pending_reports || 0,
          note: "Reports waiting for moderation",
        },
        {
          label: "Verified Items",
          value: stats.verified_items || 0,
          note: "Approved by the admin team",
        },
        {
          label: "Completed Claims",
          value: stats.claimed_items || 0,
          note: "Claims fully confirmed by both users",
        },
      ];

      $("#dashboardContent").html(`
        <div class="d-flex justify-content-between align-items-center flex-wrap gap-3 mb-4">
          <div>
            <h3 class="mb-1">Admin Dashboard</h3>
            <p class="text-muted mb-0">Live platform activity pulled from the database.</p>
          </div>
          <div class="d-flex gap-2">
            <a href="#" class="btn btn-sm btn-outline-secondary dashboardShortcut" data-page="verify-items">Pending Items</a>
            <a href="#" class="btn btn-sm btn-outline-secondary dashboardShortcut" data-page="reported-items">Reported Items</a>
            <a href="#" class="btn btn-sm btn-outline-secondary dashboardShortcut" data-page="claims-in-progress">Claims</a>
          </div>
        </div>
        <div class="row g-3 mb-4">${renderMetricCards(cards)}</div>
        <div class="row g-3">
          <div class="col-md-6">
            <div class="card dashboard-panel shadow-sm border-0 h-100">
              <div class="card-body">
                <div class="metric-label">Inventory</div>
                <div class="panel-value">${escapeHtml(stats.total_items || 0)}</div>
                <div class="text-muted">Total active items in the system</div>
              </div>
            </div>
          </div>
          <div class="col-md-6">
            <div class="card dashboard-panel shadow-sm border-0 h-100">
              <div class="card-body">
                <div class="metric-label">Claims In Progress</div>
                <div class="panel-value">${escapeHtml(stats.in_progress_claims || 0)}</div>
                <div class="text-muted">Claims currently moving through handoff</div>
              </div>
            </div>
          </div>
        </div>
      `);
    },
    error() {
      $("#dashboardContent").html(
        '<div class="alert alert-danger">Failed to load admin dashboard data.</div>',
      );
    },
  });
}

function renderUserMatchesView() {
  $("#dashboardContent").html(`
    <div class="d-flex justify-content-between align-items-center mb-4">
      <div>
        <h3 class="mb-1">Possible Matches</h3>
        <p class="text-muted mb-0">Review found-item suggestions for the lost items you reported.</p>
      </div>
      <a href="upload.html" class="btn btn-primary">Report Another Item</a>
    </div>
    <div id="matchesList" class="row g-3"></div>
  `);
  loadMatches();
}

function renderNotificationsView() {
  $("#dashboardContent").html(`
    <div class="d-flex justify-content-between align-items-center mb-4">
      <div>
        <h3 class="mb-1">Notifications</h3>
        <p class="text-muted mb-0">Track claim requests, handoff progress, and contact updates.</p>
      </div>
    </div>
    <div class="mb-4">
      <h5 class="mb-3">Claims On My Found Items</h5>
      <div id="incomingClaimsList" class="d-grid gap-3"></div>
    </div>
    <div>
      <h5 class="mb-3">General Notifications</h5>
      <div id="notificationsList" class="d-grid gap-3"></div>
    </div>
  `);
  loadIncomingClaims();
  loadNotifications();
}

function showProfileFeedback(message, type = "success") {
  $("#profileFeedback").html(`
    <div class="alert alert-${type} mb-0">${escapeHtml(message)}</div>
  `);
}

function loadMyItems() {
  $("#myItemsTable").html(
    "<tr><td colspan='5' class='text-center'><div class='spinner-border spinner-border-sm me-2'></div>Loading items...</td></tr>",
  );
  $.ajax({
    url: window.location.origin + "/my-items",
    method: "GET",
    headers: authHeaders(),
    success(items) {
      if (!items.length) {
        $("#myItemsTable").html(
          "<tr><td colspan='5' class='text-center'>No active items right now.</td></tr>",
        );
        return;
      }

      const rows = items
        .map(
          (item) => `
            <tr>
              <td><a href="${getItemDetailsUrl(item.id)}">${escapeHtml(item.title)}</a></td>
              <td>${escapeHtml(item.category)}</td>
              <td>${escapeHtml(item.location)}</td>
              <td>${getStatusBadge(item.status)}</td>
               <td>
                 <div class="action-buttons">
                   <button class="btn btn-sm btn-warning editItem" data-id="${item.id}">
                     <i class="bi bi-pencil-square"></i> Edit
                   </button>
                   <button class="btn btn-sm btn-danger deleteItem" data-id="${item.id}">
                     <i class="bi bi-trash"></i> Delete
                   </button>
                 </div>
               </td>
            </tr>`,
        )
        .join("");

      $("#myItemsTable").html(rows);
    },
    error() {
      $("#myItemsTable").html(
        "<tr><td colspan='5'>Failed to load items</td></tr>",
      );
    },
  });
}

function loadClaimedItems() {
  $.ajax({
    url: window.location.origin + "/my-claimed-items",
    method: "GET",
    headers: authHeaders(),
    success(items) {
      if (!items.length) {
        $("#claimedItemsList").html(
          '<div class="alert alert-light border mb-0">No completed claims yet.</div>',
        );
        return;
      }

      const cards = items
        .map(
          (item) => `
            <div class="card dashboard-panel shadow-sm border-0">
              <div class="card-body">
                <div class="d-flex justify-content-between align-items-start gap-3">
                  <div>
                    <h5 class="mb-1">
                      <a href="${getItemDetailsUrl(item.found_item_id)}">${escapeHtml(item.found_title)}</a>
                    </h5>
                    <p class="text-muted mb-2">
                      Lost report: <a href="${getItemDetailsUrl(item.lost_item_id)}">${escapeHtml(item.lost_title)}</a>
                    </p>
                  </div>
                  ${getStatusBadge(item.claim_status)}
                </div>
                <div class="small text-muted">
                  Claimant: ${escapeHtml(item.claimant_name)} | Finder: ${escapeHtml(item.finder_name)} | Completed on: ${formatDate(item.created_at)}
                </div>
              </div>
            </div>
          `,
        )
        .join("");

      $("#claimedItemsList").html(cards);
    },
    error() {
      $("#claimedItemsList").html(
        '<div class="alert alert-danger mb-0">Failed to load claimed items.</div>',
      );
    },
  });
}

function loadMatches() {
  if ($("#matchesList").length) {
    $("#matchesList").html(
      "<div class='col-12 text-center py-5 text-muted'><div class='spinner-border'></div><div class='mt-2'>Loading matches...</div></div>",
    );
  }
  $.ajax({
    url: window.location.origin + "/matches",
    method: "GET",
    headers: authHeaders(),
    success(matches) {
      if (!matches.length) {
        $("#matchesList").html(`
          <div class="col-12">
            <div class="card dashboard-panel shadow-sm border-0">
              <div class="card-body">
                <h5 class="mb-2">No match suggestions yet</h5>
                <p class="text-muted mb-0">When the system finds a likely found-item match for one of your lost reports, it will appear here.</p>
              </div>
            </div>
          </div>
        `);
        return;
      }

      const cards = matches
        .map((match) => {
          const image = match.found_image_url
            ? window.location.origin + match.found_image_url
            : "https://via.placeholder.com/400x240?text=Found+Item";
          const claimStatus = getClaimStatus(match);

          return `
            <div class="col-12">
              <div class="card dashboard-panel shadow-sm border-0 overflow-hidden">
                <div class="row g-0">
                  <div class="col-md-4">
                    <img src="${image}" class="img-fluid h-100 w-100" style="object-fit: cover; min-height: 240px;" alt="Possible found item">
                  </div>
                  <div class="col-md-8">
                    <div class="card-body p-4">
                      <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
                        <div>
                          <h5 class="mb-1">${escapeHtml(match.found_title)}</h5>
                          <p class="text-muted mb-0">Possible match for your lost item "${escapeHtml(match.lost_title)}"</p>
                        </div>
                        ${getStatusBadge(claimStatus)}
                      </div>
                      <div class="row g-3 mb-3">
                        <div class="col-md-6">
                          <small class="text-muted d-block">Category</small>
                          <strong>${escapeHtml(match.found_category)}</strong>
                        </div>
                        <div class="col-md-6">
                          <small class="text-muted d-block">Location</small>
                          <strong>${escapeHtml(match.found_location)}</strong>
                        </div>
                        <div class="col-md-6">
                          <small class="text-muted d-block">Reported By</small>
                          <strong>${escapeHtml(match.found_reported_by)}</strong>
                        </div>
                        <div class="col-md-6">
                          <small class="text-muted d-block">Match Confidence</small>
                          <strong>${Number(match.confidence_score || 0).toFixed(0)}%</strong>
                        </div>
                      </div>
                      <p class="mb-3">${escapeHtml(match.found_description || "No description provided.")}</p>
                      <div class="small text-muted mb-3">
                        Found date: ${formatDate(match.found_date)} | Suggested on: ${formatDate(match.created_at)}
                      </div>
                      ${renderClaimTimeline(match)}
                      <div class="d-flex flex-wrap gap-2">
                        <a href="${getItemDetailsUrl(match.found_item_id)}" class="btn btn-outline-secondary btn-sm">View Item</a>
                        ${renderOutgoingClaimActions(match)}
                      </div>
                      ${
                        claimStatus === "pending"
                          ? '<div class="alert alert-info mt-3 mb-0">Your contact request is waiting for the found-item reporter to respond.</div>'
                          : ""
                      }
                      ${
                        claimStatus === "contact_shared"
                          ? '<div class="alert alert-primary mt-3 mb-0">Contact has been shared. Meet offline, then confirm the handoff here.</div>'
                          : ""
                      }
                      ${
                        claimStatus === "in_progress"
                          ? '<div class="alert alert-info mt-3 mb-0">One side already confirmed the handoff. Complete the final confirmation when ready.</div>'
                          : ""
                      }
                      ${
                        claimStatus === "completed"
                          ? '<div class="alert alert-success mt-3 mb-0">This claim is complete. Coins were rewarded only after both confirmations.</div>'
                          : ""
                      }
                      ${
                        claimStatus === "rejected"
                          ? '<div class="alert alert-secondary mt-3 mb-0">This match has been closed.</div>'
                          : ""
                      }
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
        })
        .join("");

      $("#matchesList").html(cards);
    },
    error() {
      $("#matchesList").html(
        '<div class="col-12"><div class="alert alert-danger mb-0">Failed to load your matches.</div></div>',
      );
    },
  });
}

function loadIncomingClaims() {
  $("#incomingClaimsList").html(
    "<div class='card dashboard-panel shadow-sm border-0'><div class='card-body text-muted'><div class='spinner-border spinner-border-sm me-2'></div>Loading claims...</div></div>",
  );
  $.ajax({
    url: window.location.origin + "/claims/incoming",
    method: "GET",
    headers: authHeaders(),
    success(claims) {
      if (!claims.length) {
        $("#incomingClaimsList").html(
          '<div class="card dashboard-panel shadow-sm border-0"><div class="card-body text-muted">No active claims on your found items.</div></div>',
        );
        return;
      }

      const cards = claims
        .map((claim) => {
          const claimStatus = getClaimStatus(claim);
          const image = claim.found_image_url
            ? window.location.origin + claim.found_image_url
            : "https://via.placeholder.com/240x180?text=Claim";

          return `
            <div class="card dashboard-panel shadow-sm border-0">
              <div class="card-body">
                <div class="row g-3 align-items-center">
                  <div class="col-md-3">
                    <img src="${image}" class="img-fluid rounded" alt="Claim item">
                  </div>
                  <div class="col-md-9">
                    <div class="d-flex justify-content-between align-items-start gap-3">
                      <div>
                        <h5 class="mb-1">${escapeHtml(claim.found_title)}</h5>
                        <p class="text-muted mb-1">Requested by ${escapeHtml(claim.claimant_name)} for lost item "${escapeHtml(claim.lost_title)}"</p>
                      </div>
                      ${getStatusBadge(claimStatus)}
                    </div>
                    ${renderClaimTimeline(claim)}
                    <div class="d-flex flex-wrap gap-2 mt-3">
                      ${
                        claimStatus === "pending"
                          ? `<button class="btn btn-primary btn-sm shareClaimContact" data-id="${claim.claim_id}" data-share-email="1" data-share-phone="1"><i class="bi bi-share"></i> Share Contact</button>
                             <button class="btn btn-outline-danger btn-sm rejectClaim" data-id="${claim.claim_id}" data-label="Not his item">Not his item</button>`
                          : ""
                      }
                      ${
                        (claimStatus === "contact_shared" ||
                          claimStatus === "in_progress") &&
                        !claim.delivered_confirmed
                          ? `<button class="btn btn-success btn-sm confirmDelivered" data-id="${claim.claim_id}"><i class="bi bi-box-seam"></i> I delivered the item</button>`
                          : ""
                      }
                      ${
                        claimStatus === "completed"
                          ? `<button class="btn btn-outline-primary btn-sm rateClaimUser" data-id="${claim.claim_id}" data-target="claimant">Rate claimant</button>`
                          : ""
                      }
                      ${
                        ["contact_shared", "in_progress", "completed"].includes(
                          claimStatus,
                        )
                          ? `<button class="btn btn-outline-warning btn-sm reportClaimUser" data-id="${claim.claim_id}">Report user</button>`
                          : ""
                      }
                    </div>
                    ${
                      claim.delivered_confirmed
                        ? '<div class="small text-success mt-2">You already confirmed delivery.</div>'
                        : ""
                    }
                    ${
                      claim.received_confirmed
                        ? '<div class="small text-success mt-1">The claimant confirmed receipt.</div>'
                        : ""
                    }
                  </div>
                </div>
              </div>
            </div>
          `;
        })
        .join("");

      $("#incomingClaimsList").html(cards);
    },
    error() {
      $("#incomingClaimsList").html(
        '<div class="alert alert-danger mb-0">Failed to load incoming claims.</div>',
      );
    },
  });
}

function loadNotifications() {
  $("#notificationsList").html(
    "<div class='card dashboard-panel shadow-sm border-0'><div class='card-body text-muted'><div class='spinner-border spinner-border-sm me-2'></div>Loading notifications...</div></div>",
  );
  $.ajax({
    url: window.location.origin + "/notifications",
    method: "GET",
    headers: authHeaders(),
    success(notifications) {
      if (!notifications.length) {
        $("#notificationsList").html(`
          <div class="card dashboard-panel shadow-sm border-0">
            <div class="card-body">
              <h5 class="mb-2">No notifications yet</h5>
              <p class="text-muted mb-0">Updates about match suggestions and contact requests will appear here.</p>
            </div>
          </div>
        `);
        return;
      }

      const cards = notifications
        .map(
          (notification) => `
            <div class="card dashboard-panel shadow-sm border-0 ${notification.is_read ? "" : "notification-new"}">
              <div class="card-body">
                <div class="d-flex justify-content-between align-items-start gap-3">
                  <div>
                    <h5 class="mb-1">${escapeHtml(notification.title)}</h5>
                    <p class="mb-2">${escapeHtml(notification.message)}</p>
                    <div class="small text-muted">${formatDate(notification.created_at)}</div>
                  </div>
                  <div class="d-flex flex-column align-items-end gap-2">
                    ${notification.claim_status ? getStatusBadge(notification.claim_status) : ""}
                    ${notification.is_read ? '<span class="badge bg-light text-dark">Read</span>' : '<span class="badge bg-primary">New</span>'}
                  </div>
                </div>
                ${notificationActionsMarkup(notification)}
                ${
                  !notification.is_read
                    ? `<div class="mt-3">
                         <button class="btn btn-sm btn-outline-secondary markNotificationRead" data-id="${notification.id}">Mark as read</button>
                       </div>`
                    : ""
                }
              </div>
            </div>`,
        )
        .join("");

      $("#notificationsList").html(cards);
    },
    error() {
      $("#notificationsList").html(
        '<div class="alert alert-danger mb-0">Failed to load notifications.</div>',
      );
    },
  });
}

function loadProfile() {
  fetch(window.location.origin + "/profile", { headers: authHeaders() })
    .then((res) => res.json())
    .then((profile) => {
      $("#profileName").text(profile.name);
      $("#profileEmail").text(profile.email);
      $("#profilePhone").text(profile.phone);
      $("#profileDate").text(new Date(profile.created_at).toLocaleDateString());
      $("#profileCoins").text(`${profile.coins || 0} coins`);
      $("#profileUploads").text(profile.total_uploaded || 0);
      $("#profileReturns").text(profile.successful_returns || 0);
      $("#profileClaims").text(profile.total_claims || 0);
      $("#editProfileName").val(profile.name);
      $("#editProfileEmail").val(profile.email);
      $("#editProfilePhone").val(profile.phone);
      if ($("#welcomeName").length) {
        $("#welcomeName").text(profile.name);
      }
    })
    .catch(() => {
      $("#dashboardContent").append(
        '<div class="alert alert-danger mt-3">Failed to load profile.</div>',
      );
    });
}

function loadPendingItems() {
  $("#pendingItemsTable").html(
    "<tr><td colspan='6' class='text-center'><div class='spinner-border spinner-border-sm me-2'></div>Loading pending items...</td></tr>",
  );
  $.ajax({
    url: window.location.origin + "/admin/items/pending",
    method: "GET",
    headers: authHeaders(),
    success(items) {
      let rows = "";

      if (!items.length) {
        rows =
          "<tr><td colspan='6' class='text-center'>No pending items</td></tr>";
      }

      items.forEach((item) => {
        rows += `
          <tr>
            <td><a href="${getItemDetailsUrl(item.id)}">${escapeHtml(item.title)}</a></td>
            <td>${escapeHtml(item.item_type)}</td>
            <td>${escapeHtml(item.category)}</td>
            <td>${escapeHtml(item.location)}</td>
            <td><a href="${getAdminUserUrl(item.reported_by_id)}">${escapeHtml(item.reported_by)}</a></td>
            <td>
              <button class="btn btn-success btn-sm verifyItem" data-id="${item.id}">Verify</button>
              <button class="btn btn-danger btn-sm rejectItem" data-id="${item.id}">Reject</button>
            </td>
          </tr>
        `;
      });

      $("#pendingItemsTable").html(rows);
    },
    error() {
      $("#pendingItemsTable").html(
        "<tr><td colspan='6'>Failed to load items</td></tr>",
      );
    },
  });
}

async function handleVerification(itemId, action, triggerEl) {
  const approved = await confirmAction(
    `Are you sure you want to ${action} this item?`,
    "Review Item",
  );
  if (!approved) return;
  const restoreButton = setActionLoading($(triggerEl), "Processing...");
  $.ajax({
    url: window.location.origin + "/admin/items/verify",
    method: "POST",
    contentType: "application/json",
    headers: authHeaders(),
    data: JSON.stringify({ item_id: itemId, action }),
    success(res) {
      notify(res.message, "success");
      loadPendingItems();
    },
    error() {
      notify("Action failed", "error");
    },
    complete() {
      restoreButton();
    },
  });
}

function renderPagination(containerId, pagination, callbackName) {
  if (!pagination || pagination.total_pages <= 1) {
    $(`#${containerId}`).html("");
    return;
  }

  let buttons = "";

  for (let page = 1; page <= pagination.total_pages; page += 1) {
    buttons += `
      <button class="btn btn-sm ${page === pagination.page ? "btn-primary" : "btn-outline-secondary"} paginationButton"
        data-callback="${callbackName}" data-page="${page}">
        ${page}
      </button>`;
  }

  $(`#${containerId}`).html(
    `<div class="d-flex flex-wrap gap-2 justify-content-end mt-3">${buttons}</div>`,
  );
}

function loadReportedItems(page = 1) {
  $("#reportedItemsTable").html(
    "<tr><td colspan='8' class='text-center'><div class='spinner-border spinner-border-sm me-2'></div>Loading reports...</td></tr>",
  );
  $.ajax({
    url: `${window.location.origin}/admin/reported-items?page=${page}&limit=8`,
    method: "GET",
    headers: authHeaders(),
    success(response) {
      const reports = response.reports || [];
      let rows = "";

      if (!reports.length) {
        rows =
          "<tr><td colspan='8' class='text-center'>No reported items</td></tr>";
      }

      reports.forEach((report) => {
        rows += `
          <tr>
            <td><a href="${getItemDetailsUrl(report.item_id)}">${escapeHtml(report.title)}</a></td>
            <td><a href="${getAdminUserUrl(report.item_owner_id)}">${escapeHtml(report.item_owner)}</a></td>
            <td><a href="${getAdminUserUrl(report.reported_by_id)}">${escapeHtml(report.reported_by)}</a></td>
            <td>${escapeHtml(report.reason)}</td>
            <td>${escapeHtml(report.description || "-")}</td>
            <td>${getStatusBadge(report.status)}</td>
            <td>${formatDate(report.reported_at)}</td>
            <td>
              <button class="btn btn-danger btn-sm deleteReportedItem" data-report="${report.report_id}">Delete Item</button>
              <button class="btn btn-secondary btn-sm ignoreReport" data-report="${report.report_id}">Ignore</button>
            </td>
          </tr>
        `;
      });

      $("#reportedItemsTable").html(rows);
      renderPagination(
        "reportedItemsPagination",
        response.pagination,
        "loadReportedItems",
      );
    },
    error() {
      $("#reportedItemsTable").html(
        "<tr><td colspan='8'>Failed to load reports</td></tr>",
      );
      $("#reportedItemsPagination").html("");
    },
  });
}

async function handleReportAction(reportId, action, triggerEl) {
  const note = prompt("Optional admin note:");

  const approved = await confirmAction(
    `Confirm ${action} action?`,
    "Moderation Action",
  );
  if (!approved) return;
  const restoreButton = setActionLoading($(triggerEl), "Processing...");

  $.ajax({
    url: window.location.origin + "/admin/reports/action",
    method: "POST",
    contentType: "application/json",
    headers: authHeaders(),
    data: JSON.stringify({
      report_id: reportId,
      action,
      admin_note: note,
    }),
    success(res) {
      notify(res.message, "success");
      loadReportedItems();
    },
    error() {
      notify("Action failed", "error");
    },
    complete() {
      restoreButton();
    },
  });
}

function loadLogs() {
  $("#logsTable").html(
    "<tr><td colspan='6' class='text-center'><div class='spinner-border spinner-border-sm me-2'></div>Loading logs...</td></tr>",
  );
  $.ajax({
    url: window.location.origin + "/admin/logs",
    method: "GET",
    headers: authHeaders(),
    success(logs) {
      const rows = logs
        .map(
          (log) => `
            <tr>
              <td><a href="${getAdminUserUrl(log.admin_user_id)}">${escapeHtml(log.admin_name)}</a></td>
              <td>${escapeHtml(log.action_type)}</td>
              <td>${escapeHtml(log.target_type)}</td>
              <td>${escapeHtml(log.target_id)}</td>
              <td>${escapeHtml(log.details || "-")}</td>
              <td>${new Date(log.created_at).toLocaleString()}</td>
            </tr>`,
        )
        .join("");

      $("#logsTable").html(rows);
    },
  });
}

function loadUsers() {
  $("#usersTable").html(
    "<tr><td colspan='5' class='text-center'><div class='spinner-border spinner-border-sm me-2'></div>Loading users...</td></tr>",
  );
  $.ajax({
    url: window.location.origin + "/admin/users",
    method: "GET",
    headers: authHeaders(),
    success(users) {
      const rows = users
        .map(
          (entry) => `
            <tr>
              <td><a href="${getAdminUserUrl(entry.id)}">${escapeHtml(entry.full_name)}</a></td>
              <td>${escapeHtml(entry.email)}</td>
              <td>${escapeHtml(entry.role)}</td>
              <td>${new Date(entry.created_at).toLocaleDateString()}</td>
              <td>
                <button class="btn btn-danger btn-sm deleteUser" data-id="${entry.id}">Delete</button>
              </td>
            </tr>`,
        )
        .join("");

      $("#usersTable").html(rows);
    },
  });
}

function loadPaymentRequests() {
  $("#paymentRequestsTable").html(
    "<tr><td colspan='7' class='text-center'><div class='spinner-border spinner-border-sm me-2'></div>Loading payment requests...</td></tr>",
  );
  $.ajax({
    url: window.location.origin + "/admin/payment-requests",
    method: "GET",
    headers: authHeaders(),
    success(requests) {
      const rows = requests.length
        ? requests
            .map(
              (request) => `
                <tr>
                  <td><a href="${getAdminUserUrl(request.user_id)}">${escapeHtml(request.user_name)}</a></td>
                  <td>${escapeHtml(request.requested_coins)}</td>
                  <td>${escapeHtml(request.payment_method)}</td>
                  <td>${escapeHtml(request.payment_reference)}</td>
                  <td>${formatDate(request.created_at)}</td>
                  <td>${getStatusBadge(request.status)}</td>
                  <td>
                    ${
                      request.status === "pending"
                        ? `<button class="btn btn-success btn-sm reviewPaymentRequest" data-id="${request.id}" data-action="approve" data-coins="${request.requested_coins}">Approve</button>
                           <button class="btn btn-outline-danger btn-sm reviewPaymentRequest" data-id="${request.id}" data-action="reject">Reject</button>`
                        : ""
                    }
                  </td>
                </tr>`,
            )
            .join("")
        : "<tr><td colspan='7' class='text-center'>No payment requests found.</td></tr>";

      $("#paymentRequestsTable").html(rows);
    },
  });
}

function loadAdminClaims(group) {
  $.ajax({
    url: window.location.origin + "/admin/claims?group=" + group,
    method: "GET",
    headers: authHeaders(),
    success(claims) {
      const showDeleteAction = group === "completed";
      const rows = claims.length
        ? claims
            .map(
              (claim) => `
                <tr>
                  <td><a href="${getItemDetailsUrl(claim.found_item_id)}">${escapeHtml(claim.found_title)}</a></td>
                  <td><a href="${getAdminUserUrl(claim.claimant_id)}">${escapeHtml(claim.claimant_name)}</a></td>
                  <td><a href="${getAdminUserUrl(claim.finder_id)}">${escapeHtml(claim.finder_name)}</a></td>
                  <td>${getStatusBadge(claim.claim_status)}</td>
                  <td>${claim.delivered_confirmed ? "Yes" : "No"}</td>
                  <td>${claim.received_confirmed ? "Yes" : "No"}</td>
                  <td>${formatDate(claim.created_at)}</td>
                  <td>
                    ${showDeleteAction ? `<button class="btn btn-sm btn-outline-danger deleteItem" data-id="${claim.found_item_id}" data-refresh="completed-claims">Remove Item</button>` : '<span class="text-muted small">In progress</span>'}
                  </td>
                </tr>`,
            )
            .join("")
        : "<tr><td colspan='8' class='text-center'>No claims found.</td></tr>";

      $("#adminClaimsTable").html(rows);
    },
  });
}

function loadSuspiciousUsers() {
  $.ajax({
    url: window.location.origin + "/admin/suspicious-users",
    method: "GET",
    headers: authHeaders(),
    success(users) {
      const rows = users.length
        ? users
            .map(
              (entry) => `
                <tr>
                  <td><a href="${getAdminUserUrl(entry.id)}">${escapeHtml(entry.full_name)}</a></td>
                  <td>${entry.failed_claims}</td>
                  <td>${entry.reports_received}</td>
                  <td>${entry.success_rate}%</td>
                  <td>${entry.trust_score}</td>
                </tr>`,
            )
            .join("")
        : "<tr><td colspan='5' class='text-center'>No suspicious users right now.</td></tr>";

      $("#suspiciousUsersTable").html(rows);
    },
  });
}

function renderProfileView() {
  $("#dashboardContent").html(`
    <div class="d-flex justify-content-between align-items-center mb-4">
      <div>
        <h3 class="mb-1">My Profile</h3>
        <p class="text-muted mb-0">Keep your personal details up to date and track your activity.</p>
      </div>
      <button class="btn btn-light border rounded-circle" id="openEditProfile" title="Edit profile">
        <i class="bi bi-pencil"></i>
      </button>
    </div>
    <div id="profileFeedback" class="mb-3"></div>
    <div class="row g-3">
      <div class="col-lg-7">
        <div class="card dashboard-panel shadow-sm border-0">
          <div class="card-body p-4">
            <h4 id="profileName" class="mb-3"></h4>
            <div class="row g-3">
              <div class="col-md-6"><div class="metric-label">Email</div><div id="profileEmail"></div></div>
              <div class="col-md-6"><div class="metric-label">Phone</div><div id="profilePhone"></div></div>
              <div class="col-md-6"><div class="metric-label">Joined</div><div id="profileDate"></div></div>
              <div class="col-md-6"><div class="metric-label">Coins</div><div id="profileCoins"></div></div>
            </div>
          </div>
        </div>
      </div>
      <div class="col-lg-5">
        <div class="row g-3">
          <div class="col-12">
            <div class="card metric-card border-0 shadow-sm"><div class="card-body"><div class="metric-label">Total Uploaded</div><div class="metric-value" id="profileUploads"></div></div></div>
          </div>
          <div class="col-12">
            <div class="card metric-card border-0 shadow-sm"><div class="card-body"><div class="metric-label">Successful Returns</div><div class="metric-value" id="profileReturns"></div></div></div>
          </div>
          <div class="col-12">
            <div class="card metric-card border-0 shadow-sm"><div class="card-body"><div class="metric-label">Claims Made</div><div class="metric-value" id="profileClaims"></div></div></div>
          </div>
        </div>
      </div>
    </div>
    <div class="card border-danger shadow-sm mt-4">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-center flex-wrap gap-3">
          <div>
            <h5 class="text-danger mb-1">Delete Account</h5>
            <p class="text-muted mb-0">This removes your profile, items, claims, and related activity.</p>
          </div>
          <button class="btn btn-outline-danger" id="deleteAccountBtn">Delete Account</button>
        </div>
      </div>
    </div>
    <div class="modal fade" id="editProfileModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Edit Profile</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Full Name</label>
              <input id="editProfileName" class="form-control">
            </div>
            <div class="mb-3">
              <label class="form-label">Email</label>
              <input id="editProfileEmail" class="form-control">
            </div>
            <div class="mb-0">
              <label class="form-label">Phone</label>
              <input id="editProfilePhone" class="form-control">
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="saveProfileBtn">Save Changes</button>
          </div>
        </div>
      </div>
    </div>
  `);

  loadProfile();
}

function openDashboardPage(page) {
  $(".sidebar .nav-link").removeClass("active");
  $(`.sidebar .nav-link[data-page="${page}"]`).addClass("active");

  if (page === "admin-overview") {
    renderAdminOverview();
    return;
  }

  if (page === "user-overview") {
    renderUserOverview();
    return;
  }

  if (page === "verify-items") {
    $("#dashboardContent").html(`
      <h3>Pending Items</h3>
      <div class="card dashboard-panel p-3 mt-3 border-0 shadow-sm">
        <table class="table align-middle mb-0">
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
    return;
  }

  if (page === "reported-items") {
    $("#dashboardContent").html(`
      <h3>Reported Items</h3>
      <div class="card dashboard-panel p-3 mt-3 border-0 shadow-sm">
        <div class="table-responsive">
          <table class="table align-middle mb-0">
            <thead>
              <tr>
                <th>Item</th>
                <th>Owner</th>
                <th>Reported By</th>
                <th>Reason</th>
                <th>Description</th>
                <th>Status</th>
                <th>Reported</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="reportedItemsTable"></tbody>
          </table>
        </div>
        <div id="reportedItemsPagination"></div>
      </div>
    `);
    loadReportedItems();
    return;
  }

  if (page === "users") {
    $("#dashboardContent").html(`
      <h3>Users</h3>
      <div class="card dashboard-panel p-3 mt-3 border-0 shadow-sm">
        <table class="table align-middle mb-0">
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
    return;
  }

  if (page === "payment-requests") {
    $("#dashboardContent").html(`
      <h3>Payment Requests</h3>
      <div class="card dashboard-panel p-3 mt-3 border-0 shadow-sm">
        <table class="table align-middle mb-0">
          <thead>
            <tr>
              <th>User</th>
              <th>Coins</th>
              <th>Method</th>
              <th>Reference</th>
              <th>Date</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="paymentRequestsTable"></tbody>
        </table>
      </div>
    `);
    loadPaymentRequests();
    return;
  }

  if (page === "claims-in-progress") {
    $("#dashboardContent").html(`
      <h3>Claims In Progress</h3>
      <div class="card dashboard-panel p-3 mt-3 border-0 shadow-sm">
        <table class="table align-middle mb-0">
          <thead>
            <tr>
              <th>Item</th>
              <th>Claimant</th>
              <th>Finder</th>
              <th>Status</th>
              <th>Delivered</th>
              <th>Received</th>
              <th>Started</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="adminClaimsTable"></tbody>
        </table>
      </div>
    `);
    loadAdminClaims("in_progress");
    return;
  }

  if (page === "completed-claims") {
    $("#dashboardContent").html(`
      <h3>Completed Claims</h3>
      <div class="card dashboard-panel p-3 mt-3 border-0 shadow-sm">
        <table class="table align-middle mb-0">
          <thead>
            <tr>
              <th>Item</th>
              <th>Claimant</th>
              <th>Finder</th>
              <th>Status</th>
              <th>Delivered</th>
              <th>Received</th>
              <th>Started</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="adminClaimsTable"></tbody>
        </table>
      </div>
    `);
    loadAdminClaims("completed");
    return;
  }

  if (page === "suspicious-users") {
    $("#dashboardContent").html(`
      <h3>Suspicious Users</h3>
      <div class="card dashboard-panel p-3 mt-3 border-0 shadow-sm">
        <table class="table align-middle mb-0">
          <thead>
            <tr>
              <th>User</th>
              <th>Failed Claims</th>
              <th>Reports Received</th>
              <th>Success Rate</th>
              <th>Trust Score</th>
            </tr>
          </thead>
          <tbody id="suspiciousUsersTable"></tbody>
        </table>
      </div>
    `);
    loadSuspiciousUsers();
    return;
  }

  if (page === "logs") {
    $("#dashboardContent").html(`
      <h3>Admin Logs</h3>
      <div class="card dashboard-panel p-3 mt-3 border-0 shadow-sm">
        <table class="table align-middle mb-0">
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
    return;
  }

  if (page === "my-items") {
    $("#dashboardContent").html(`
      <h3>My Items</h3>
      <div class="card dashboard-panel p-3 mt-3 border-0 shadow-sm">
        <table class="table align-middle mb-0">
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
    return;
  }

  if (page === "claimed-items") {
    $("#dashboardContent").html(`
      <div class="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h3 class="mb-1">Claimed Items</h3>
          <p class="text-muted mb-0">Completed handoffs are kept here as a read-only history.</p>
        </div>
      </div>
      <div id="claimedItemsList" class="d-grid gap-3"></div>
    `);
    loadClaimedItems();
    return;
  }

  if (page === "matches") {
    renderUserMatchesView();
    return;
  }

  if (page === "notifications") {
    renderNotificationsView();
    return;
  }

  if (page === "profile") {
    renderProfileView();
  }
}

$(document).on("click", ".verifyItem", function () {
  handleVerification($(this).data("id"), "verified", this);
});

$(document).on("click", ".rejectItem", function () {
  handleVerification($(this).data("id"), "rejected", this);
});

$(document).on("click", ".deleteReportedItem", function () {
  handleReportAction($(this).data("report"), "delete", this);
});

$(document).on("click", ".ignoreReport", function () {
  handleReportAction($(this).data("report"), "ignore", this);
});

$(document).on("click", ".deleteItem", async function () {
  const itemId = $(this).data("id");
  const refreshTarget = $(this).data("refresh");

  const approved = await confirmAction("Delete this item?", "Delete Item");
  if (!approved) return;
  const restoreButton = setActionLoading($(this), "Deleting...");

  $.ajax({
    url: window.location.origin + "/items/" + itemId,
    method: "DELETE",
    headers: authHeaders(),
    success() {
      notify("Item deleted successfully", "success");
      if (refreshTarget) {
        openDashboardPage(refreshTarget);
      } else {
        loadMyItems();
      }
    },
    error(xhr) {
      notify(xhr.responseJSON?.message || "Failed to delete item", "error");
    },
    complete() {
      restoreButton();
    },
  });
});

$(document).on("click", ".editItem", function () {
  window.location.href = "edit-item.html?id=" + $(this).data("id");
});

$(document).on("click", ".deleteUser", async function () {
  const id = $(this).data("id");

  const approved = await confirmAction("Delete this user?", "Delete User");
  if (!approved) return;
  const restoreButton = setActionLoading($(this), "Deleting...");

  $.ajax({
    url: window.location.origin + "/admin/users/" + id,
    method: "DELETE",
    headers: authHeaders(),
    success() {
      notify("User deleted successfully", "success");
      loadUsers();
    },
    error(xhr) {
      notify(xhr.responseJSON?.message || "Failed to delete user", "error");
    },
    complete() {
      restoreButton();
    },
  });
});

$(document).on("click", ".reviewPaymentRequest", function () {
  const id = $(this).data("id");
  const action = $(this).data("action");
  const defaultCoins = $(this).data("coins");
  let approvedCoins = defaultCoins;

  if (action === "approve") {
    approvedCoins = prompt("Approve how many coins?", defaultCoins);
    if (!approvedCoins) return;
  }
  const restoreButton = setActionLoading($(this), "Processing...");

  $.ajax({
    url: window.location.origin + "/admin/payment-requests/" + id + "/review",
    method: "POST",
    contentType: "application/json",
    headers: authHeaders(),
    data: JSON.stringify({
      action,
      approved_coins: approvedCoins,
    }),
    success(res) {
      notify(res.message, "success");
      loadPaymentRequests();
    },
    error(xhr) {
      notify(xhr.responseJSON?.message || "Failed to review request", "error");
    },
    complete() {
      restoreButton();
    },
  });
});

$(document).on("click", ".requestContact", async function () {
  const id = $(this).data("id");

  const approved = await confirmAction(
    "Send a contact request for this possible match?",
    "Contact Request",
  );
  if (!approved) return;
  const restoreButton = setActionLoading($(this), "Sending...");

  $.ajax({
    url: window.location.origin + "/matches/" + id + "/request-contact",
    method: "POST",
    headers: authHeaders(),
    success(res) {
      notify(res.message, "success");
      loadMatches();
    },
    error(xhr) {
      notify(
        xhr.responseJSON?.message || "Failed to send contact request",
        "error",
      );
    },
    complete() {
      restoreButton();
    },
  });
});

$(document).on("click", ".rejectMatch", async function () {
  const id = $(this).data("id");

  const approved = await confirmAction(
    "Dismiss this possible match?",
    "Dismiss Match",
  );
  if (!approved) return;
  const restoreButton = setActionLoading($(this), "Processing...");

  $.ajax({
    url: window.location.origin + "/matches/" + id + "/reject",
    method: "POST",
    headers: authHeaders(),
    success(res) {
      notify(res.message, "success");
      loadMatches();
    },
    error(xhr) {
      notify(xhr.responseJSON?.message || "Failed to update match", "error");
    },
    complete() {
      restoreButton();
    },
  });
});

$(document).on("click", ".shareClaimContact", function () {
  const id = $(this).data("id");
  const sharePhone = Boolean($(this).data("share-phone"));
  const shareEmail = Boolean($(this).data("share-email"));
  const restoreButton = setActionLoading($(this), "Sharing...");

  $.ajax({
    url: window.location.origin + "/claims/" + id + "/share-contact",
    method: "POST",
    contentType: "application/json",
    headers: authHeaders(),
    data: JSON.stringify({
      share_phone: sharePhone,
      share_email: shareEmail,
    }),
    success(res) {
      notify(res.message, "success");
      loadIncomingClaims();
      loadNotifications();
      loadMatches();
    },
    error(xhr) {
      notify(
        xhr.responseJSON?.message || "Failed to share contact details",
        "error",
      );
    },
    complete() {
      restoreButton();
    },
  });
});

$(document).on("click", ".confirmDelivered", function () {
  const id = $(this).data("id");
  const restoreButton = setActionLoading($(this), "Saving...");

  $.ajax({
    url: window.location.origin + "/claims/" + id + "/confirm-delivered",
    method: "POST",
    headers: authHeaders(),
    success(res) {
      notify(res.message, "success");
      loadIncomingClaims();
      loadNotifications();
    },
    error(xhr) {
      notify(xhr.responseJSON?.message || "Failed to confirm delivery", "error");
    },
    complete() {
      restoreButton();
    },
  });
});

$(document).on("click", ".confirmReceived", function () {
  const id = $(this).data("id");
  const restoreButton = setActionLoading($(this), "Saving...");

  $.ajax({
    url: window.location.origin + "/claims/" + id + "/confirm-received",
    method: "POST",
    headers: authHeaders(),
    success(res) {
      notify(res.message, "success");
      loadMatches();
      loadNotifications();
    },
    error(xhr) {
      notify(xhr.responseJSON?.message || "Failed to confirm receipt", "error");
    },
    complete() {
      restoreButton();
    },
  });
});

$(document).on("click", ".rejectClaim", async function () {
  const id = $(this).data("id");
  const label = $(this).data("label") || "Close claim";

  const approved = await confirmAction(`${label}?`, "Close Claim");
  if (!approved) return;
  const restoreButton = setActionLoading($(this), "Processing...");

  $.ajax({
    url: window.location.origin + "/claims/" + id + "/reject",
    method: "POST",
    headers: authHeaders(),
    success(res) {
      notify(res.message, "success");
      loadMatches();
      loadIncomingClaims();
      loadNotifications();
    },
    error(xhr) {
      notify(xhr.responseJSON?.message || "Failed to close claim", "error");
    },
    complete() {
      restoreButton();
    },
  });
});

$(document).on("click", ".reportClaimUser", function () {
  const id = $(this).data("id");
  const reason = prompt("Report reason:");
  if (!reason) return;
  const description = prompt("Describe what happened:");
  if (!description) return;
  const restoreButton = setActionLoading($(this), "Submitting...");

  $.ajax({
    url: window.location.origin + "/claims/" + id + "/report-user",
    method: "POST",
    contentType: "application/json",
    headers: authHeaders(),
    data: JSON.stringify({ reason, description }),
    success(res) {
      notify(res.message, "success");
    },
    error(xhr) {
      notify(xhr.responseJSON?.message || "Failed to report user", "error");
    },
    complete() {
      restoreButton();
    },
  });
});

$(document).on("click", ".rateClaimUser", function () {
  const id = $(this).data("id");
  const rating = prompt("Rate this user from 1 to 5:");
  if (!rating) return;
  const comment = prompt("Optional comment:") || "";
  const restoreButton = setActionLoading($(this), "Submitting...");

  $.ajax({
    url: window.location.origin + "/claims/" + id + "/rate-user",
    method: "POST",
    contentType: "application/json",
    headers: authHeaders(),
    data: JSON.stringify({ rating, comment }),
    success(res) {
      notify(res.message, "success");
    },
    error(xhr) {
      notify(xhr.responseJSON?.message || "Failed to submit rating", "error");
    },
    complete() {
      restoreButton();
    },
  });
});

$(document).on("click", ".respondContactRequest", function () {
  const id = $(this).data("id");
  const decision = $(this).data("decision");
  const sharePhone = Boolean($(this).data("share-phone"));
  const shareEmail = Boolean($(this).data("share-email"));
  const restoreButton = setActionLoading($(this), "Processing...");

  $.ajax({
    url:
      window.location.origin +
      "/notifications/" +
      id +
      "/respond-contact-request",
    method: "POST",
    contentType: "application/json",
    headers: authHeaders(),
    data: JSON.stringify({
      decision,
      share_phone: sharePhone,
      share_email: shareEmail,
    }),
    success(res) {
      notify(res.message, "success");
      loadNotifications();
    },
    error(xhr) {
      notify(xhr.responseJSON?.message || "Failed to process request", "error");
    },
    complete() {
      restoreButton();
    },
  });
});

$(document).on("click", ".markNotificationRead", function () {
  const id = $(this).data("id");
  const restoreButton = setActionLoading($(this), "Marking...");

  $.ajax({
    url: window.location.origin + "/notifications/" + id + "/read",
    method: "POST",
    headers: authHeaders(),
    success() {
      loadNotifications();
    },
    complete() {
      restoreButton();
    },
  });
});

$(document).on("click", ".dashboardShortcut", function (e) {
  e.preventDefault();
  openDashboardPage($(this).data("page"));
});

$(document).on("click", "#openEditProfile", function () {
  const modalEl = document.getElementById("editProfileModal");
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
});

$(document).on("click", "#saveProfileBtn", function () {
  const fullName = $("#editProfileName").val().trim();
  const email = $("#editProfileEmail").val().trim();
  const phone = $("#editProfilePhone").val().trim();

  if (!fullName || !email || !phone) {
    showProfileFeedback("Fill in name, email, and phone before saving.", "danger");
    return;
  }

  const restoreButton = setActionLoading($(this), "Saving...");
  $.ajax({
    url: window.location.origin + "/profile",
    method: "PUT",
    contentType: "application/json",
    headers: authHeaders(),
    data: JSON.stringify({
      full_name: fullName,
      email,
      phone,
    }),
    success(res) {
      const updatedUser = JSON.parse(localStorage.getItem("user") || "{}");
      updatedUser.full_name = fullName;
      updatedUser.email = email;
      updatedUser.phone = phone;
      localStorage.setItem("user", JSON.stringify(updatedUser));
      const modal = bootstrap.Modal.getOrCreateInstance(
        document.getElementById("editProfileModal"),
      );
      modal.hide();
      showProfileFeedback(res.message, "success");
      loadProfile();
    },
    error(xhr) {
      showProfileFeedback(
        xhr.responseJSON?.message || "Failed to update profile",
        "danger",
      );
    },
    complete() {
      restoreButton();
    },
  });
});

$(document).on("click", "#deleteAccountBtn", async function () {
  const approved = await confirmAction(
    "Delete your account permanently? This cannot be undone.",
    "Delete Account",
  );
  if (!approved) {
    return;
  }
  const restoreButton = setActionLoading($(this), "Deleting...");

  $.ajax({
    url: window.location.origin + "/profile",
    method: "DELETE",
    headers: authHeaders(),
    success(res) {
      notify(res.message, "success");
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "index.html";
    },
    error(xhr) {
      showProfileFeedback(
        xhr.responseJSON?.message || "Failed to delete account",
        "danger",
      );
    },
    complete() {
      restoreButton();
    },
  });
});

$(document).on("click", ".paginationButton", function () {
  const callbackName = $(this).data("callback");
  const page = $(this).data("page");

  if (callbackName === "loadReportedItems") {
    loadReportedItems(page);
  }
});

$(document).ready(function () {
  if (!token || !user) {
    window.location.href = "login.html";
    return;
  }

  if ($("#welcomeName").length) {
    $("#welcomeName").text(user.full_name);
  }

  $(".sidebar .nav-link").on("click", function (e) {
    const page = $(this).data("page");

    if (!page) {
      return;
    }

    e.preventDefault();
    openDashboardPage(page);
  });

  if (window.location.pathname.endsWith("admin-dashboard.html")) {
    openDashboardPage("admin-overview");
    return;
  }

  if (window.location.pathname.endsWith("user-dashboard.html")) {
    openDashboardPage("user-overview");
  }
});
