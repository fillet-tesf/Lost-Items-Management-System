# Lost Item Management System (LIMS) Project Documentation

## CHAPTER TWO: NAMING AND CODING STANDARD

### 2.1 Naming Standard

The project follows a consistent naming convention across the backend and frontend layers:

*   **JavaScript Variables and Functions:** Uses `camelCase`. Examples: `calculateMatchConfidence`, `getUserReputationSummary`, `authMiddleware`, `itemId`.
*   **Constants:** Uses `SCREAMING_SNAKE_CASE` for global configuration and fixed values. Examples: `MATCH_SCORE_THRESHOLD`, `WARNING_REPORT_THRESHOLD`, `PORT`.
*   **Database Tables and Columns:** Uses `snake_case`. Examples: `item_status_id`, `user_id`, `lost_date`, `found_date`, `is_verified`.
*   **CSS Classes:** Uses kebab-case for styling. Examples: `stat-card`, `upload-card`, `mobile-toggle`.
*   **API Endpoints:** Follows RESTful conventions using plural nouns and `snake-case` or `camelCase` for parameters. Examples: `/items/:id`, `/admin/reported-items`, `/user/dashboard-summary`.

### 2.2 Coding Standard

The system is built using modern web technologies with a focus on modularity and security:

*   **Backend:** Node.js with Express framework. Asynchronous operations are handled using `async/await` and Promises for cleaner code flow and better error management.
*   **Database Interaction:** Uses the `mysql2` driver with a centralized `db.js` configuration. Raw SQL queries are utilized with parameterized inputs to prevent SQL Injection.
*   **Authentication:** JSON Web Token (JWT) is used for secure session management. Password security is ensured through `bcrypt` hashing.
*   **Frontend:** A combination of jQuery for DOM manipulation and AJAX calls, and Bootstrap 5 for responsive UI design.
*   **Error Handling:** The backend uses standard HTTP status codes (200, 201, 400, 401, 403, 404, 500) and returns JSON error messages to the client.
*   **File Storage:** `multer` is used for handling multipart/form-data, specifically for item image uploads, which are stored in the `backend/uploads/items/` directory.

---

## CHAPTER THREE: ALGORITHM DESIGN

### 3.1 Item Matching Algorithm

The core of the LIMS project is the `calculateMatchConfidence` algorithm, which automatically identifies potential matches between "Lost" and "Found" reports.

**Scoring Components:**
1.  **Category Check:** If `category_id` does not match, the confidence score is immediately 0.
2.  **Base Score:** Starts at 45 points if categories match.
3.  **Location Match:** Adds 20 points if the `location_id` is identical.
4.  **Token Overlap (Text Analysis):**
    *   The `tokenizeText` function processes the title and description, removing punctuation and "stop words" (e.g., "the", "and").
    *   The `getTokenOverlapScore` adds 8 points per matching unique token, up to a maximum of 24 points.
5.  **Date Proximity:**
    *   Calculated via `getDateScore` based on the difference between `lost_date` and `found_date`.
    *   <= 2 days: +15 points.
    *   <= 7 days: +10 points.
    *   <= 30 days: +5 points.
6.  **Title Match:** Adds 10 points if the titles are an exact case-insensitive match.

**Threshold:** The system uses a `MATCH_SCORE_THRESHOLD` of 55 points. Only matches above this threshold are proposed to users.

### 3.2 Search and Filtering

The `/items` endpoint implements a flexible search algorithm:
*   **Keyword Search:** Uses SQL `LIKE` operators on both title and description fields.
*   **Categorical Filtering:** Filters by `type` (lost/found), `category_id`, and `location_id`.
*   **Pagination:** Implements server-side pagination with `limit` and `offset` to ensure performance as the database grows.

### 3.3 Reputation and Badge System

The system manages user trust through a dynamic reputation algorithm:
*   **Trust Score Calculation:** Based on successful returns, ratings received, and reports against the user.
*   **Automatic Badges:**
    *   **Blue Badge (Trusted Beginner):** Awarded after the first successful item return.
    *   **Green Badge (Trusted Helper):** Awarded after multiple successful returns.
    *   **Warning Badge:** Automatically assigned if a user receives 2 or more reports (defined by `WARNING_REPORT_THRESHOLD`). This badge is visible to other users during contact requests.

---

## CHAPTER FOUR: TESTING PROCEDURE

### 4.1 Testing Methods

Currently, the codebase relies on **Manual Testing** and **Frontend Validation**. There is no automated test suite (e.g., Jest or Mocha) implemented in the current version.

**Manual Testing Procedures:**
*   **Authentication Flow:** Verifying sign-up, login, and JWT token persistence in `localStorage`.
*   **Item Reporting:** Testing the `uploadForm` with various inputs, including image file handling.
*   **Matching Flow:** Creating a lost item and a found item with similar attributes to trigger the `calculateMatchConfidence` logic and notification.
*   **Admin Moderation:** Testing item verification, rejection (with reasons), and handling reported items.

### 4.2 Frontend Validation

The `frontend/js/main.js` script includes real-time validation:
*   Required fields check for all submission forms.
*   Password matching validation on signup.
*   Email format validation.
*   Visual feedback using Bootstrap `is-invalid` classes.

### 4.3 Recommendations for Testing

To improve system reliability, the following should be implemented:
1.  **Unit Testing:** Use **Jest** to test utility functions like `calculateMatchConfidence` and `tokenizeText`.
2.  **Integration Testing:** Use **Supertest** to verify API endpoints and database interactions.
3.  **End-to-End Testing:** Use **Playwright** or **Cypress** to simulate user journeys from registration to item recovery.

---

## CHAPTER FIVE: INSTALLATION GUIDELINE AND USER MANUAL

### 5.1 Installation Steps

**Server and Dependencies:**
1.  Install **Node.js** (v14 or higher).
2.  Navigate to the `backend/` directory.
3.  Run `npm install` to install dependencies listed in `package.json` (`express`, `mysql2`, `jsonwebtoken`, `bcrypt`, `multer`, `cors`, etc.).

**Database Setup:**
1.  Install and start **MySQL Server**.
2.  Create a database named `lims_db`.
3.  Import the schema (see Appendix for table structures).
4.  Update `backend/db.js` with your local MySQL credentials.

**Environment Configuration:**
1.  Create a `.env` file in the `backend/` directory.
2.  Define `JWT_SECRET` and `JWT_EXPIRES_IN`.

**Running the System:**
1.  Start the backend: `npm start` in the `backend/` folder.
2.  The frontend is served statically; open `frontend/index.html` via a local web server (e.g., Live Server) or access it via the backend's static route if configured.

### 5.2 User Manual

#### Regular User Role
*   **Reporting:** Use the "Report Item" page to submit lost or found items. Lost reports require a 10-coin fee.
*   **Dashboard:** View personal stats, recent items, and match notifications.
*   **Matches:** Review "Possible Matches" suggested by the system. Users can "Request Contact" or "Dismiss" matches.
*   **Claims:** Track the handoff process. Both the finder and claimant must confirm the delivery/receipt to complete the claim and earn/spend coins.
*   **Wallet:** View transaction history and submit payment requests to recharge coins.

#### Admin Role
*   **Item Verification:** Review pending items in the Admin Dashboard. Items can be "Verified" to appear in public search or "Rejected" with a reason sent to the user.
*   **Moderation:** Resolve reports against items or users. Admins can delete items or dismiss reports.
*   **User Management:** View all registered users, their trust scores, and badges. Admins can delete accounts if necessary.
*   **Finance:** Review and approve/reject coin recharge requests.
*   **Logs:** Monitor system-wide administrative actions.

---

## CHAPTER SIX: CONCLUSION AND RECOMMENDATION

### 6.1 Conclusion

The Lost Item Management System provides a comprehensive solution for campus or community lost and found needs. By implementing an automated matching algorithm and a trust-based reputation system, it reduces the manual effort required to reunite owners with their belongings while maintaining a high standard of security and accountability.

### 6.2 Recommendations

1.  **Automated Testing:** Implement a robust CI/CD pipeline with automated unit and integration tests.
2.  **Real-time Updates:** Integrate WebSockets (Socket.io) to provide instant notifications for matches and claim updates without requiring page refreshes.
3.  **AI Integration:** Explore the use of Image Recognition (e.g., TensorFlow.js) to compare uploaded images for better matching accuracy.
4.  **Mobile Application:** Develop a native mobile version or a PWA for better accessibility and push notifications.

---

## APPENDIX

### Database Schema (Inferred from Code)

| Table | Primary Key | Description |
| :--- | :--- | :--- |
| `users` | `id` | Stores user profiles, hashed passwords, role, and coin balance. |
| `items` | `id` | Stores item details, status, categories, locations, and images. |
| `matches` | `id` | Links lost and found items with a confidence score. |
| `item_claims` | `id` | Tracks the handoff process and confirmation status. |
| `notifications` | `id` | Stores alerts for matches, contact requests, and admin actions. |
| `user_stats` | `user_id` | Cached counters for uploads, returns, and reports. |
| `reported_items`| `id` | Moderation queue for flagged content. |
| `coin_transactions`| `id`| Audit log for all coin balance changes. |

### Matching Algorithm Snippet

```javascript
function calculateMatchConfidence(lostItem, foundItem) {
  if (Number(lostItem.category_id) !== Number(foundItem.category_id)) {
    return 0;
  }

  let score = 45;

  if (Number(lostItem.location_id) === Number(foundItem.location_id)) {
    score += 20;
  }

  score += getTokenOverlapScore(lostItem, foundItem);
  score += getDateScore(lostItem, foundItem);

  if (String(lostItem.title || "").trim().toLowerCase() ===
      String(foundItem.title || "").trim().toLowerCase()) {
    score += 10;
  }

  return Number(Math.min(score, 99.99).toFixed(2));
}
```
