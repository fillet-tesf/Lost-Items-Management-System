require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const db = require("./db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const authMiddleware = require("./authMiddleware");

// multer configuration for file uploads can be added here if needed

const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/items");
  },
  filename: (req, file, cb) => {
    const uniqueName =
      Date.now() +
      "-" +
      Math.round(Math.random() * 1e9) +
      path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

const app = express();
const PORT = 3000;

const MATCH_NOTIFICATION_TITLE = "Possible match found";
const CONTACT_REQUEST_TITLE = "Contact info request";
const CONTACT_SHARED_TITLE = "Contact info shared";
const CONTACT_DECLINED_TITLE = "Contact request declined";
const CLAIM_COMPLETED_TITLE = "Claim completed";
const CLAIM_UPDATE_TITLE = "Claim update";
const ITEM_REJECTED_TITLE = "Item Rejected";
const WARNING_BADGE_TITLE = "Warning Badge Assigned";
const WARNING_BADGE_REMOVED_TITLE = "Warning Badge Removed";
const RETURN_BADGE_TITLE = "Return Badge Earned";
const MATCH_SCORE_THRESHOLD = 55;
const WARNING_REPORT_THRESHOLD = 2;
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "have",
  "near",
  "item",
  "lost",
  "found",
  "black",
  "white",
]);

function queryAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(results);
    });
  });
}

async function ensureReputationTables() {
  await queryAsync(
    `CREATE TABLE IF NOT EXISTS user_reputation_flags (
      user_id INT PRIMARY KEY,
      warning_cleared TINYINT(1) DEFAULT 0,
      warning_notified TINYINT(1) DEFAULT 0,
      last_return_badge_notified ENUM('none','blue','green') DEFAULT 'none',
      warning_cleared_by INT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (warning_cleared_by) REFERENCES users(id)
    )`,
  );

  await queryAsync(
    `CREATE TABLE IF NOT EXISTS badge_appeals (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      badge_type ENUM('warning') DEFAULT 'warning',
      reason TEXT NOT NULL,
      status ENUM('pending','approved','rejected') DEFAULT 'pending',
      reviewed_by INT NULL,
      admin_note TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TIMESTAMP NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    )`,
  );
}

async function ensureSchemaAdditions() {
  try {
    await queryAsync("ALTER TABLE items ADD COLUMN rejection_reason TEXT NULL");
  } catch (error) {
    if (error.code !== "ER_DUP_FIELDNAME") {
      throw error;
    }
  }
}

async function ensureUserReputationFlagRow(userId) {
  await queryAsync(
    `INSERT INTO user_reputation_flags (user_id)
     VALUES (?)
     ON DUPLICATE KEY UPDATE user_id = user_id`,
    [userId],
  );
}

function getBadgePayload(summary) {
  const badges = [];

  if (summary.return_badge === "blue") {
    badges.push({
      key: "blue",
      label: "Trusted Beginner",
      color: "primary",
      icon: "bi-award-fill",
      tooltip: "This user has successfully returned 1 item",
    });
  }

  if (summary.return_badge === "green") {
    badges.push({
      key: "green",
      label: "Trusted Helper",
      color: "success",
      icon: "bi-star-fill",
      tooltip: "This user has successfully returned multiple items",
    });
  }

  if (summary.warning_badge) {
    badges.push({
      key: "warning",
      label: "Warning",
      color: "danger",
      icon: "bi-exclamation-triangle-fill",
      tooltip: "Warning: This user has received multiple reports. تعامل carefully.",
    });
  }

  return badges;
}

async function getUserReputationSummary(userId) {
  await ensureUserReputationFlagRow(userId);

  const [returns] = await queryAsync(
    `SELECT COUNT(*) AS successful_returns
     FROM item_claims
     JOIN items ON item_claims.item_id = items.id
     WHERE items.user_id = ?
       AND items.item_type = 'found'
       AND item_claims.status = 'completed'`,
    [userId],
  );

  const [ratings] = await queryAsync(
    `SELECT
       AVG(rating) AS average_rating,
       COUNT(*) AS rating_count
     FROM user_ratings
     WHERE to_user = ?`,
    [userId],
  );

  const [reports] = await queryAsync(
    `SELECT
       (
         (SELECT COUNT(*)
          FROM reported_items
          JOIN items ON reported_items.item_id = items.id
          WHERE items.user_id = ?)
         +
         (SELECT COUNT(*) FROM user_reports WHERE reported_user_id = ?)
       ) AS reports_received`,
    [userId, userId],
  );

  const [flags] = await queryAsync(
    `SELECT warning_cleared, warning_notified, last_return_badge_notified
     FROM user_reputation_flags
     WHERE user_id = ?`,
    [userId],
  );

  const successfulReturns = Number(returns?.successful_returns || 0);
  const reportsReceived = Number(reports?.reports_received || 0);
  const warningCleared = Boolean(flags?.warning_cleared);

  let returnBadge = null;
  if (successfulReturns >= 2) returnBadge = "green";
  else if (successfulReturns >= 1) returnBadge = "blue";

  const warningBadge =
    reportsReceived >= WARNING_REPORT_THRESHOLD && !warningCleared;

  return {
    average_rating: Number(ratings?.average_rating || 0),
    rating_count: Number(ratings?.rating_count || 0),
    successful_returns: successfulReturns,
    reports_received: reportsReceived,
    return_badge: returnBadge,
    warning_badge: warningBadge,
    warning_cleared: warningCleared,
    warning_notified: Boolean(flags?.warning_notified),
    last_return_badge_notified: flags?.last_return_badge_notified || "none",
    badges: getBadgePayload({
      return_badge: returnBadge,
      warning_badge: warningBadge,
    }),
  };
}

async function maybeNotifyReturnBadge(userId, itemTitle) {
  const summary = await getUserReputationSummary(userId);
  const badge = summary.return_badge || "none";

  if (
    badge !== "none" &&
    summary.last_return_badge_notified !== badge
  ) {
    await createNotification(
      userId,
      RETURN_BADGE_TITLE,
      badge === "green"
        ? `You earned the Green Badge after successfully returning multiple items. Latest item: "${itemTitle}".`
        : `You earned the Blue Badge after your first successful item return. Item: "${itemTitle}".`,
    );

    await queryAsync(
      `UPDATE user_reputation_flags
       SET last_return_badge_notified = ?
       WHERE user_id = ?`,
      [badge, userId],
    );
  }
}

async function maybeAssignWarningBadge(userId) {
  const summary = await getUserReputationSummary(userId);

  if (summary.warning_badge && !summary.warning_notified) {
    await createNotification(
      userId,
      WARNING_BADGE_TITLE,
      "Your account now has a warning badge due to multiple reports. You can submit an appeal from your profile.",
    );

    await queryAsync(
      `UPDATE user_reputation_flags
       SET warning_notified = 1,
           warning_cleared = 0
       WHERE user_id = ?`,
      [userId],
    );
  }
}

function tokenizeText(value) {
  return new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );
}

function getItemDate(item) {
  return item.item_type === "lost" ? item.lost_date : item.found_date;
}

function getTokenOverlapScore(lostItem, foundItem) {
  const lostTokens = tokenizeText(
    `${lostItem.title || ""} ${lostItem.description || ""}`,
  );
  const foundTokens = tokenizeText(
    `${foundItem.title || ""} ${foundItem.description || ""}`,
  );

  let overlap = 0;

  lostTokens.forEach((token) => {
    if (foundTokens.has(token)) {
      overlap += 1;
    }
  });

  return Math.min(overlap * 8, 24);
}

function getDateScore(lostItem, foundItem) {
  const lostDate = getItemDate(lostItem);
  const foundDate = getItemDate(foundItem);

  if (!lostDate || !foundDate) {
    return 0;
  }

  const diffMs = Math.abs(new Date(foundDate) - new Date(lostDate));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 2) return 15;
  if (diffDays <= 7) return 10;
  if (diffDays <= 30) return 5;

  return 0;
}

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

  if (
    String(lostItem.title || "")
      .trim()
      .toLowerCase() ===
    String(foundItem.title || "")
      .trim()
      .toLowerCase()
  ) {
    score += 10;
  }

  return Number(Math.min(score, 99.99).toFixed(2));
}

async function createNotification(
  userId,
  title,
  message,
  relatedItemId = null,
  relatedMatchId = null,
) {
  await queryAsync(
    `INSERT INTO notifications (user_id, title, message, related_item_id, related_match_id)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, title, message, relatedItemId, relatedMatchId],
  );
}

async function createMatchIfNeeded(lostItem, foundItem, proposedBy) {
  const confidenceScore = calculateMatchConfidence(lostItem, foundItem);

  if (confidenceScore < MATCH_SCORE_THRESHOLD) {
    return false;
  }

  const existingMatches = await queryAsync(
    "SELECT id FROM matches WHERE lost_item_id = ? AND found_item_id = ?",
    [lostItem.id, foundItem.id],
  );

  if (existingMatches.length > 0) {
    return false;
  }

  const insertResult = await queryAsync(
    `INSERT INTO matches (lost_item_id, found_item_id, match_status, proposed_by, confidence_score)
     VALUES (?, ?, 'proposed', ?, ?)`,
    [lostItem.id, foundItem.id, proposedBy, confidenceScore],
  );

  await createNotification(
    lostItem.user_id,
    MATCH_NOTIFICATION_TITLE,
    `We found a possible match for your lost item "${lostItem.title}". A reported found item titled "${foundItem.title}" looks similar.`,
    lostItem.id,
    insertResult.insertId,
  );

  return true;
}

async function reconcileBestMatchForFoundItem(foundItemId, proposedBy) {
  const foundItem = await getItemById(foundItemId);

  if (
    !foundItem ||
    foundItem.item_type !== "found" ||
    ["deleted", "rejected", "claimed", "returned"].includes(
      foundItem.status_name,
    )
  ) {
    return { created: false };
  }

  const existingMatches = await queryAsync(
    `SELECT id, lost_item_id, match_status
     FROM matches
     WHERE found_item_id = ?`,
    [foundItem.id],
  );

  if (
    existingMatches.some((match) =>
      ["confirmed", "claimed"].includes(match.match_status),
    )
  ) {
    return { created: false };
  }

  const rejectedLostItemIds = new Set(
    existingMatches
      .filter((match) => match.match_status === "rejected")
      .map((match) => String(match.lost_item_id)),
  );

  const lostItems = await queryAsync(
    `SELECT
       i.id,
       i.user_id,
       i.item_type,
       i.title,
       i.description,
       i.category_id,
       i.location_id,
       i.lost_date,
       i.found_date
     FROM items i
     JOIN item_statuses s ON i.item_status_id = s.id
     WHERE i.item_type = 'lost'
       AND i.category_id = ?
       AND i.user_id != ?
       AND s.status_name NOT IN ('deleted', 'rejected', 'claimed', 'returned')`,
    [foundItem.category_id, foundItem.user_id],
  );

  const candidates = lostItems
    .filter((lostItem) => !rejectedLostItemIds.has(String(lostItem.id)))
    .map((lostItem) => ({
      lostItem,
      confidence_score: calculateMatchConfidence(lostItem, foundItem),
    }))
    .filter((candidate) => candidate.confidence_score >= MATCH_SCORE_THRESHOLD);

  const bestCandidate = chooseBestScoredCandidate(candidates);
  const proposedMatches = existingMatches.filter(
    (match) => match.match_status === "proposed",
  );

  if (!bestCandidate) {
    await deleteMatchSuggestions(proposedMatches.map((match) => match.id));
    return { created: false };
  }

  const retainedMatch = proposedMatches.find(
    (match) => Number(match.lost_item_id) === Number(bestCandidate.lostItem.id),
  );
  const staleMatchIds = proposedMatches
    .filter(
      (match) =>
        Number(match.lost_item_id) !== Number(bestCandidate.lostItem.id),
    )
    .map((match) => match.id);

  await deleteMatchSuggestions(staleMatchIds);

  if (retainedMatch) {
    await queryAsync(
      `UPDATE matches
       SET confidence_score = ?,
           proposed_by = ?
       WHERE id = ?`,
      [bestCandidate.confidence_score, proposedBy, retainedMatch.id],
    );

    return { created: false };
  }

  const created = await createMatchIfNeeded(
    bestCandidate.lostItem,
    foundItem,
    proposedBy,
  );

  return { created };
}

async function generateMatchesForItem(itemId, proposedBy) {
  const currentItem = await getItemById(itemId);

  if (!currentItem) {
    return { createdCount: 0 };
  }

  if (
    ["deleted", "rejected", "claimed", "returned"].includes(
      currentItem.status_name,
    )
  ) {
    return { createdCount: 0 };
  }

  let createdCount = 0;

  if (currentItem.item_type === "found") {
    const result = await reconcileBestMatchForFoundItem(
      currentItem.id,
      proposedBy,
    );

    if (result.created) {
      createdCount += 1;
    }

    return { createdCount };
  }

  const candidateFoundItems = await queryAsync(
    `SELECT i.id
     FROM items i
     JOIN item_statuses s ON i.item_status_id = s.id
     WHERE i.item_type = 'found'
       AND i.category_id = ?
       AND i.user_id != ?
       AND i.id != ?
       AND s.status_name NOT IN ('deleted', 'rejected', 'claimed', 'returned')`,
    [currentItem.category_id, currentItem.user_id, currentItem.id],
  );

  for (const candidate of candidateFoundItems) {
    const result = await reconcileBestMatchForFoundItem(
      candidate.id,
      proposedBy,
    );

    if (result.created) {
      createdCount += 1;
    }
  }

  return { createdCount };
}

function getPaginationParams(query, defaultLimit = 9, maxLimit = 50) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(
    Math.max(parseInt(query.limit, 10) || defaultLimit, 1),
    maxLimit,
  );

  return {
    page,
    limit,
    offset: (page - 1) * limit,
    enabled: Object.prototype.hasOwnProperty.call(query, "page"),
  };
}

async function getStatusIdByName(statusName) {
  const results = await queryAsync(
    "SELECT id FROM item_statuses WHERE status_name = ? LIMIT 1",
    [statusName],
  );

  return results[0]?.id || null;
}

function getAbsoluteUploadPath(imageUrl) {
  if (!imageUrl) {
    return null;
  }

  const normalizedPath = String(imageUrl).replace(/^\/+/, "");
  return path.join(__dirname, "..", normalizedPath);
}

async function removeItemImage(imageUrl) {
  const absolutePath = getAbsoluteUploadPath(imageUrl);

  if (!absolutePath) {
    return;
  }

  try {
    await fs.promises.unlink(absolutePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(`Failed to remove image file ${absolutePath}:`, error);
    }
  }
}

async function deleteRowsByIds(tableName, columnName, ids) {
  if (!ids.length) {
    return;
  }

  const placeholders = ids.map(() => "?").join(", ");
  await queryAsync(
    `DELETE FROM ${tableName} WHERE ${columnName} IN (${placeholders})`,
    ids,
  );
}

function chooseBestScoredCandidate(candidates) {
  if (!candidates.length) {
    return null;
  }

  const bestScore = Math.max(
    ...candidates.map((candidate) => Number(candidate.confidence_score)),
  );
  const tiedCandidates = candidates.filter(
    (candidate) => Number(candidate.confidence_score) === bestScore,
  );

  return tiedCandidates[Math.floor(Math.random() * tiedCandidates.length)];
}

async function getItemById(itemId) {
  const items = await queryAsync(
    `SELECT
       i.id,
       i.user_id,
       i.item_type,
       i.title,
       i.description,
       i.category_id,
       i.location_id,
       i.lost_date,
       i.found_date,
       i.image_url,
       s.status_name
     FROM items i
     JOIN item_statuses s ON i.item_status_id = s.id
     WHERE i.id = ?`,
    [itemId],
  );

  return items[0] || null;
}

async function deleteMatchSuggestions(matchIds) {
  if (!matchIds.length) {
    return;
  }

  const placeholders = matchIds.map(() => "?").join(", ");

  await queryAsync(
    `DELETE FROM notifications
     WHERE related_match_id IN (${placeholders})`,
    matchIds,
  );

  await queryAsync(
    `DELETE FROM matches
     WHERE id IN (${placeholders})`,
    matchIds,
  );
}

async function ensureUserStatsRow(userId) {
  await queryAsync(
    `INSERT INTO user_stats (user_id)
     VALUES (?)
     ON DUPLICATE KEY UPDATE user_id = user_id`,
    [userId],
  );
}

async function recalculateUserStats(userId) {
  await ensureUserStatsRow(userId);

  const [uploaded] = await queryAsync(
    `SELECT COUNT(*) AS total_uploaded
     FROM items
     JOIN item_statuses ON items.item_status_id = item_statuses.id
     WHERE items.user_id = ?
       AND item_statuses.status_name != 'deleted'`,
    [userId],
  );

  const [claims] = await queryAsync(
    `SELECT
       COUNT(*) AS total_claims,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS successful_claims
     FROM item_claims
     WHERE claimant_id = ?`,
    [userId],
  );

  const [returns] = await queryAsync(
    `SELECT COUNT(*) AS successful_returns
     FROM item_claims
     JOIN items ON item_claims.item_id = items.id
     WHERE items.user_id = ?
       AND items.item_type = 'found'
       AND item_claims.status = 'completed'`,
    [userId],
  );

  const [reportsMade] = await queryAsync(
    `SELECT
       (
         (SELECT COUNT(*) FROM reported_items WHERE reported_by = ?)
         +
         (SELECT COUNT(*) FROM user_reports WHERE reported_by = ?)
       ) AS reports_made`,
    [userId, userId],
  );

  const [reportsReceived] = await queryAsync(
    `SELECT
       (
         (SELECT COUNT(*)
          FROM reported_items
          JOIN items ON reported_items.item_id = items.id
          WHERE items.user_id = ?)
         +
         (SELECT COUNT(*) FROM user_reports WHERE reported_user_id = ?)
       ) AS reports_received`,
    [userId, userId],
  );

  await queryAsync(
    `UPDATE user_stats
     SET total_uploaded = ?,
         total_claims = ?,
         successful_returns = ?,
         reports_made = ?,
         reports_received = ?
     WHERE user_id = ?`,
    [
      uploaded.total_uploaded || 0,
      claims.total_claims || 0,
      returns.successful_returns || 0,
      reportsMade.reports_made || 0,
      reportsReceived.reports_received || 0,
      userId,
    ],
  );
}

async function createOrUpdateClaim(itemId, claimantId, status) {
  const existingClaims = await queryAsync(
    "SELECT id FROM item_claims WHERE item_id = ? AND claimant_id = ?",
    [itemId, claimantId],
  );

  if (existingClaims.length > 0) {
    await queryAsync(
      `UPDATE item_claims
       SET status = ?,
           contact_shared = CASE WHEN ? = 'contact_shared' THEN 1 ELSE contact_shared END,
           delivered_confirmed = CASE WHEN ? = 'pending' THEN 0 ELSE delivered_confirmed END,
           received_confirmed = CASE WHEN ? = 'pending' THEN 0 ELSE received_confirmed END
       WHERE id = ?`,
      [status, status, status, status, existingClaims[0].id],
    );
    return existingClaims[0].id;
  }

  const result = await queryAsync(
    `INSERT INTO item_claims
      (item_id, claimant_id, status, contact_shared, delivered_confirmed, received_confirmed)
     VALUES (?, ?, ?, ?, 0, 0)`,
    [itemId, claimantId, status, status === "contact_shared" ? 1 : 0],
  );

  return result.insertId;
}

async function getClaimContextByMatchId(matchId) {
  const results = await queryAsync(
    `SELECT
       m.id AS match_id,
       m.match_status,
       m.confidence_score,
       lost.id AS lost_item_id,
       lost.title AS lost_title,
       lost.category_id AS lost_category_id,
       lost.user_id AS lost_owner_id,
       found.id AS found_item_id,
       found.title AS found_title,
       found.category_id AS found_category_id,
       found.user_id AS found_owner_id,
       claimant.full_name AS claimant_name,
       finder.full_name AS finder_name,
       ic.id AS claim_id,
       ic.status AS claim_status,
       ic.contact_shared,
       ic.delivered_confirmed,
       ic.received_confirmed
     FROM matches m
     JOIN items lost ON m.lost_item_id = lost.id
     JOIN items found ON m.found_item_id = found.id
     JOIN users claimant ON lost.user_id = claimant.id
     JOIN users finder ON found.user_id = finder.id
     LEFT JOIN item_claims ic
       ON ic.item_id = found.id
      AND ic.claimant_id = lost.user_id
     WHERE m.id = ?`,
    [matchId],
  );

  return results[0] || null;
}

async function getClaimContextById(claimId) {
  const results = await queryAsync(
    `SELECT
       ic.id AS claim_id,
       ic.status AS claim_status,
       ic.contact_shared,
       ic.delivered_confirmed,
       ic.received_confirmed,
       m.id AS match_id,
       m.match_status,
       lost.id AS lost_item_id,
       lost.title AS lost_title,
       lost.user_id AS lost_owner_id,
       found.id AS found_item_id,
       found.title AS found_title,
       found.user_id AS found_owner_id,
       claimant.full_name AS claimant_name,
       finder.full_name AS finder_name
     FROM item_claims ic
     JOIN items found ON ic.item_id = found.id
     JOIN matches m ON m.found_item_id = found.id
     JOIN items lost ON m.lost_item_id = lost.id
      AND lost.user_id = ic.claimant_id
     JOIN users claimant ON claimant.id = lost.user_id
     JOIN users finder ON finder.id = found.user_id
     WHERE ic.id = ?`,
    [claimId],
  );

  return results[0] || null;
}

async function markClaimCompletedIfReady(claimId) {
  const context = await getClaimContextById(claimId);

  if (!context) {
    return null;
  }

  if (context.delivered_confirmed && context.received_confirmed) {
    const claimedStatusId = await getStatusIdByName("claimed");
    const returnedStatusId = await getStatusIdByName("returned");

    await queryAsync(
      "UPDATE item_claims SET status = 'completed' WHERE id = ?",
      [claimId],
    );
    await queryAsync(
      "UPDATE matches SET match_status = 'claimed' WHERE id = ?",
      [context.match_id],
    );
    if (claimedStatusId) {
      await queryAsync("UPDATE items SET item_status_id = ? WHERE id = ?", [
        claimedStatusId,
        context.found_item_id,
      ]);
    }
    if (returnedStatusId) {
      await queryAsync("UPDATE items SET item_status_id = ? WHERE id = ?", [
        returnedStatusId,
        context.lost_item_id,
      ]);
    }
    await adjustUserCoins(
      context.found_owner_id,
      20,
      "credit",
      `Found item completed successfully: ${context.found_title}`,
    );
    await maybeNotifyReturnBadge(context.found_owner_id, context.found_title);
    await createNotification(
      context.lost_owner_id,
      CLAIM_COMPLETED_TITLE,
      `Your claim for "${context.found_title}" is now complete. Both sides confirmed the handoff.`,
      context.found_item_id,
      context.match_id,
    );
    await createNotification(
      context.found_owner_id,
      CLAIM_COMPLETED_TITLE,
      `The claim for "${context.found_title}" is complete. Your reward has been added.`,
      context.found_item_id,
      context.match_id,
    );
    await recalculateUserStats(context.lost_owner_id);
    await recalculateUserStats(context.found_owner_id);
  }

  return getClaimContextById(claimId);
}

async function createCoinTransaction(userId, amount, type, reason) {
  await queryAsync(
    `INSERT INTO coin_transactions (user_id, amount, type, reason)
     VALUES (?, ?, ?, ?)`,
    [userId, amount, type, reason],
  );
}

async function adjustUserCoins(userId, amount, type, reason) {
  const normalizedAmount = Number(amount);

  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error("Invalid coin amount");
  }

  const [userRecord] = await queryAsync(
    "SELECT coins FROM users WHERE id = ?",
    [userId],
  );

  if (!userRecord) {
    throw new Error("User not found");
  }

  const nextBalance =
    type === "debit"
      ? userRecord.coins - normalizedAmount
      : userRecord.coins + normalizedAmount;

  if (nextBalance < 0) {
    const error = new Error("Insufficient coins");
    error.code = "INSUFFICIENT_COINS";
    throw error;
  }

  await queryAsync("UPDATE users SET coins = ? WHERE id = ?", [
    nextBalance,
    userId,
  ]);
  await createCoinTransaction(userId, normalizedAmount, type, reason);

  return nextBalance;
}

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use("/uploads", express.static("uploads"));
app.use(express.static(path.join(__dirname, "../frontend"))); // for serving frontend files if needed

Promise.all([ensureReputationTables(), ensureSchemaAdditions()]).catch((error) => {
  console.error("Failed to ensure reputation schema:", error);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

app.get("/home-items", (req, res) => {
  const sql = `
    SELECT items.*
    FROM items
    JOIN item_statuses ON items.item_status_id = item_statuses.id
    WHERE item_statuses.status_name NOT IN ('deleted', 'rejected', 'claimed', 'returned')
    ORDER BY RAND()
    LIMIT 6
  `;

  db.query(sql, (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// fetch user's own items

app.get("/my-items", authMiddleware, (req, res) => {
  const userId = req.user.userId;

  const sql = `
    SELECT 
      items.id,
      items.title,
      items.item_type,
      items.created_at,
      items.rejection_reason,
      categories.name AS category,
      locations.name AS location,
      item_statuses.status_name AS status
    FROM items
    JOIN categories ON items.category_id = categories.id
    JOIN locations ON items.location_id = locations.id
    JOIN item_statuses ON items.item_status_id = item_statuses.id
    WHERE items.user_id = ?
      AND item_statuses.status_name NOT IN ('deleted', 'claimed', 'returned')
    ORDER BY items.created_at DESC
  `;

  db.query(sql, [userId], (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Failed to fetch items" });
    }

    res.json(results);
  });
});

app.get("/my-claimed-items", authMiddleware, async (req, res) => {
  try {
    const claimedItems = await queryAsync(
      `SELECT
         ic.id AS claim_id,
         ic.created_at,
         ic.status AS claim_status,
         found.id AS found_item_id,
         found.title AS found_title,
         found.image_url AS found_image_url,
         lost.id AS lost_item_id,
         lost.title AS lost_title,
         finder.full_name AS finder_name,
         claimant.full_name AS claimant_name
       FROM item_claims ic
       JOIN items found ON ic.item_id = found.id
       JOIN matches m ON m.found_item_id = found.id
       JOIN items lost ON m.lost_item_id = lost.id
        AND lost.user_id = ic.claimant_id
       JOIN users finder ON finder.id = found.user_id
       JOIN users claimant ON claimant.id = ic.claimant_id
       WHERE ic.status = 'completed'
         AND (ic.claimant_id = ? OR found.user_id = ?)
       ORDER BY ic.created_at DESC`,
      [req.user.userId, req.user.userId],
    );

    res.json(claimedItems);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch claimed items" });
  }
});

app.get("/profile", authMiddleware, (req, res) => {
  const sql = `
    SELECT
      users.id,
      users.full_name AS name,
      users.email,
      users.phone,
      users.coins,
      users.created_at,
      COALESCE(user_stats.total_uploaded, 0) AS total_uploaded,
      COALESCE(user_stats.successful_returns, 0) AS successful_returns,
      COALESCE(user_stats.total_claims, 0) AS total_claims
    FROM users
    LEFT JOIN user_stats ON users.id = user_stats.user_id
    WHERE users.id = ?
  `;

  db.query(sql, [req.user.userId], async (err, result) => {
    if (err) return res.status(500).json(err);

    try {
      await recalculateUserStats(req.user.userId);
      db.query(sql, [req.user.userId], async (retryErr, refreshedResult) => {
        if (retryErr) return res.status(500).json(retryErr);
        const reputation = await getUserReputationSummary(req.user.userId);
        res.json({
          ...refreshedResult[0],
          average_rating: reputation.average_rating,
          rating_count: reputation.rating_count,
          badges: reputation.badges,
        });
      });
    } catch (statsError) {
      getUserReputationSummary(req.user.userId)
        .then((reputation) => {
          res.json({
            ...result[0],
            average_rating: reputation.average_rating,
            rating_count: reputation.rating_count,
            badges: reputation.badges,
          });
        })
        .catch(() => {
          res.json(result[0]);
        });
    }
  });
});

app.put("/profile", authMiddleware, async (req, res) => {
  try {
    const full_name = String(req.body.full_name || "").trim();
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const phone = String(req.body.phone || "").trim();

    if (!full_name || !email || !phone) {
      return res
        .status(400)
        .json({ message: "All profile fields are required" });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "Enter a valid email address" });
    }

    if (phone.length < 7) {
      return res.status(400).json({ message: "Enter a valid phone number" });
    }

    await queryAsync(
      `UPDATE users
       SET full_name = ?, email = ?, phone = ?
       WHERE id = ?`,
      [full_name, email, phone, req.user.userId],
    );

    res.json({ message: "Profile updated successfully" });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "That email or phone number is already in use",
      });
    }

    res.status(500).json({ message: "Failed to update profile" });
  }
});

app.delete("/profile", authMiddleware, async (req, res) => {
  if (req.user.role === "admin") {
    return res
      .status(403)
      .json({ message: "Admin accounts cannot be deleted here" });
  }

  const userId = req.user.userId;

  try {
    const ownedItems = await queryAsync(
      "SELECT id, image_url FROM items WHERE user_id = ?",
      [userId],
    );
    const ownedItemIds = ownedItems.map((item) => item.id);
    const matchRows = ownedItemIds.length
      ? await queryAsync(
          `SELECT id
           FROM matches
           WHERE lost_item_id IN (${ownedItemIds.map(() => "?").join(", ")})
              OR found_item_id IN (${ownedItemIds.map(() => "?").join(", ")})`,
          [...ownedItemIds, ...ownedItemIds],
        )
      : [];
    const matchIds = matchRows.map((match) => match.id);

    await queryAsync("START TRANSACTION");

    await queryAsync(
      `DELETE FROM notifications
       WHERE user_id = ?
          OR related_item_id IN (${ownedItemIds.length ? ownedItemIds.map(() => "?").join(", ") : "NULL"})
          OR related_match_id IN (${matchIds.length ? matchIds.map(() => "?").join(", ") : "NULL"})`,
      [userId, ...ownedItemIds, ...matchIds],
    );

    if (ownedItemIds.length) {
      await queryAsync(
        `DELETE FROM reported_items
         WHERE reported_by = ?
            OR item_id IN (${ownedItemIds.map(() => "?").join(", ")})`,
        [userId, ...ownedItemIds],
      );
      await queryAsync(
        `DELETE FROM item_history
         WHERE user_id = ?
            OR item_id IN (${ownedItemIds.map(() => "?").join(", ")})`,
        [userId, ...ownedItemIds],
      );
      await queryAsync(
        `DELETE FROM item_claims
         WHERE claimant_id = ?
            OR item_id IN (${ownedItemIds.map(() => "?").join(", ")})`,
        [userId, ...ownedItemIds],
      );
      await queryAsync(
        `DELETE FROM matches
         WHERE lost_item_id IN (${ownedItemIds.map(() => "?").join(", ")})
            OR found_item_id IN (${ownedItemIds.map(() => "?").join(", ")})`,
        [...ownedItemIds, ...ownedItemIds],
      );
      await queryAsync(
        `DELETE FROM items
         WHERE user_id = ?`,
        [userId],
      );
    } else {
      await queryAsync("DELETE FROM item_claims WHERE claimant_id = ?", [
        userId,
      ]);
    }

    await queryAsync(
      "DELETE FROM user_reports WHERE reported_by = ? OR reported_user_id = ?",
      [userId, userId],
    );
    await queryAsync(
      "DELETE FROM user_ratings WHERE from_user = ? OR to_user = ?",
      [userId, userId],
    );
    await queryAsync(
      "DELETE FROM payment_requests WHERE user_id = ? OR admin_id = ?",
      [userId, userId],
    );
    await queryAsync("DELETE FROM coin_transactions WHERE user_id = ?", [
      userId,
    ]);
    await queryAsync("DELETE FROM user_stats WHERE user_id = ?", [userId]);
    await queryAsync("DELETE FROM users WHERE id = ?", [userId]);

    await queryAsync("COMMIT");

    for (const item of ownedItems) {
      await removeItemImage(item.image_url);
    }

    res.json({ message: "Account deleted successfully" });
  } catch (error) {
    try {
      await queryAsync("ROLLBACK");
    } catch (rollbackError) {
      console.error("Failed to rollback profile deletion:", rollbackError);
    }

    res.status(500).json({ message: "Failed to delete account" });
  }
});

app.get("/user/dashboard-summary", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const reputation = await getUserReputationSummary(userId);

    const [itemStats] = await queryAsync(
      `SELECT
         COUNT(*) AS total_reported,
         SUM(CASE WHEN item_statuses.status_name = 'pending' THEN 1 ELSE 0 END) AS pending_items
       FROM items
       JOIN item_statuses ON items.item_status_id = item_statuses.id
      WHERE items.user_id = ?
         AND item_statuses.status_name != 'deleted'`,
      [userId],
    );

    const [matchStats] = await queryAsync(
      `SELECT
         COUNT(*) AS total_matches,
         SUM(CASE WHEN matches.match_status = 'claimed' THEN 1 ELSE 0 END) AS claimed_matches
       FROM matches
       JOIN items lost ON matches.lost_item_id = lost.id
       WHERE lost.user_id = ?`,
      [userId],
    );

    const [notificationStats] = await queryAsync(
      `SELECT
         COUNT(*) AS unread_notifications
       FROM notifications
       WHERE user_id = ?
         AND is_read = 0`,
      [userId],
    );

    const [walletStats] = await queryAsync(
      "SELECT coins FROM users WHERE id = ?",
      [userId],
    );

    const recentItems = await queryAsync(
      `SELECT
         items.id,
         items.title,
         items.item_type,
         items.created_at,
         categories.name AS category,
         locations.name AS location,
         item_statuses.status_name AS status
       FROM items
       JOIN categories ON items.category_id = categories.id
       JOIN locations ON items.location_id = locations.id
       JOIN item_statuses ON items.item_status_id = item_statuses.id
       WHERE items.user_id = ?
         AND item_statuses.status_name NOT IN ('deleted', 'claimed', 'returned')
       ORDER BY items.created_at DESC
       LIMIT 5`,
      [userId],
    );

    res.json({
      stats: {
        total_reported: itemStats.total_reported || 0,
        total_matches: matchStats.total_matches || 0,
        pending_items: itemStats.pending_items || 0,
        claimed_matches: matchStats.claimed_matches || 0,
        unread_notifications: notificationStats.unread_notifications || 0,
        coins: walletStats.coins || 0,
        average_rating: Number(reputation.average_rating || 0),
        rating_count: reputation.rating_count || 0,
        badges: reputation.badges || [],
      },
      recent_items: recentItems,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to load dashboard summary" });
  }
});

// fetch items with optional filters

app.get("/items", (req, res) => {
  const { type, category, location, q } = req.query;
  const pagination = getPaginationParams(req.query);

  let baseSql = `
    SELECT 
      items.id,
      items.item_type,
      items.title,
      items.description,
      items.image_url,
      items.created_at,
      categories.name AS category,
      locations.name AS location,
      item_statuses.status_name AS status,
      users.full_name AS reported_by,
      (
        SELECT AVG(r.rating)
        FROM user_ratings r
        WHERE r.to_user = users.id
      ) AS reporter_average_rating,
      (
        SELECT COUNT(*)
        FROM user_ratings r
        WHERE r.to_user = users.id
      ) AS reporter_rating_count,
      (
        SELECT COUNT(*)
        FROM item_claims ic
        JOIN items fi ON ic.item_id = fi.id
        WHERE fi.user_id = users.id
          AND fi.item_type = 'found'
          AND ic.status = 'completed'
      ) AS reporter_successful_returns,
      (
        (SELECT COUNT(*)
         FROM reported_items rp
         JOIN items ri ON rp.item_id = ri.id
         WHERE ri.user_id = users.id)
        +
        (SELECT COUNT(*)
         FROM user_reports ur
         WHERE ur.reported_user_id = users.id)
      ) AS reporter_reports_received,
      COALESCE(rep_flags.warning_cleared, 0) AS reporter_warning_cleared
    FROM items
    JOIN categories ON items.category_id = categories.id
    JOIN locations ON items.location_id = locations.id
    JOIN item_statuses ON items.item_status_id = item_statuses.id
    JOIN users ON items.user_id = users.id
    WHERE item_statuses.status_name NOT IN ('deleted', 'rejected', 'claimed', 'returned')
   `;

  const params = [];

  // lost / found filter
  if (type) {
    baseSql += " AND items.item_type = ?";
    params.push(type);
  }

  // category filter
  if (category) {
    baseSql += " AND items.category_id = ?";
    params.push(category);
  }

  // location filter
  if (location) {
    baseSql += " AND items.location_id = ?";
    params.push(location);
  }

  // keyword search
  if (q) {
    baseSql += " AND (items.title LIKE ? OR items.description LIKE ?)";
    params.push(`%${q}%`, `%${q}%`);
  }

  let sql = `${baseSql} ORDER BY items.created_at DESC`;

  if (pagination.enabled) {
    sql += " LIMIT ? OFFSET ?";
  }

  const queryParams = pagination.enabled
    ? [...params, pagination.limit, pagination.offset]
    : params;

  db.query(sql, queryParams, (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Failed to fetch items" });
    }

    const mappedResults = results.map((item) => {
      const successfulReturns = Number(item.reporter_successful_returns || 0);
      const reportsReceived = Number(item.reporter_reports_received || 0);
      const warningBadge =
        reportsReceived >= WARNING_REPORT_THRESHOLD &&
        !Boolean(item.reporter_warning_cleared);
      let returnBadge = null;
      if (successfulReturns >= 2) returnBadge = "green";
      else if (successfulReturns >= 1) returnBadge = "blue";

      return {
        ...item,
        reporter_badges: getBadgePayload({
          return_badge: returnBadge,
          warning_badge: warningBadge,
        }),
      };
    });

    if (!pagination.enabled) {
      return res.json(mappedResults);
    }

    const countSql = `
      SELECT COUNT(*) AS total
      FROM (
        ${baseSql}
      ) AS filtered_items
    `;

    db.query(countSql, params, (countErr, countResults) => {
      if (countErr) {
        return res.status(500).json({ message: "Failed to fetch item count" });
      }

      const total = countResults[0].total;

      res.json({
        items: mappedResults,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total,
          total_pages: Math.max(Math.ceil(total / pagination.limit), 1),
        },
      });
    });
  });
});

// fetch single item details

app.get("/items/:id", (req, res) => {
  const itemId = req.params.id;

  const sql = `
    SELECT 
      items.id,
      items.user_id,
      items.item_type,
      items.title,
      items.description,
      items.category_id,
      items.location_id,
      items.image_url,
      items.rejection_reason,
      items.lost_date,
      items.found_date,
      items.created_at,
      categories.name AS category,
      locations.name AS location,
      item_statuses.status_name AS status,
      users.full_name AS reported_by,
      (
        SELECT AVG(r.rating)
        FROM user_ratings r
        WHERE r.to_user = users.id
      ) AS reporter_average_rating,
      (
        SELECT COUNT(*)
        FROM user_ratings r
        WHERE r.to_user = users.id
      ) AS reporter_rating_count,
      (
        SELECT COUNT(*)
        FROM item_claims ic
        JOIN items fi ON ic.item_id = fi.id
        WHERE fi.user_id = users.id
          AND fi.item_type = 'found'
          AND ic.status = 'completed'
      ) AS reporter_successful_returns,
      (
        (SELECT COUNT(*)
         FROM reported_items rp
         JOIN items ri ON rp.item_id = ri.id
         WHERE ri.user_id = users.id)
        +
        (SELECT COUNT(*)
         FROM user_reports ur
         WHERE ur.reported_user_id = users.id)
      ) AS reporter_reports_received,
      COALESCE(rep_flags.warning_cleared, 0) AS reporter_warning_cleared
    FROM items
    JOIN categories ON items.category_id = categories.id
    JOIN locations ON items.location_id = locations.id
    JOIN item_statuses ON items.item_status_id = item_statuses.id
    JOIN users ON items.user_id = users.id
    LEFT JOIN user_reputation_flags rep_flags ON rep_flags.user_id = users.id
    WHERE items.id = ?
  `;

  db.query(sql, [itemId], (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Failed to fetch item" });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "Item not found" });
    }

    const item = results[0];
    const successfulReturns = Number(item.reporter_successful_returns || 0);
    const reportsReceived = Number(item.reporter_reports_received || 0);
    const warningBadge =
      reportsReceived >= WARNING_REPORT_THRESHOLD &&
      !Boolean(item.reporter_warning_cleared);

    let returnBadge = null;
    if (successfulReturns >= 2) returnBadge = "green";
    else if (successfulReturns >= 1) returnBadge = "blue";

    res.json({
      ...item,
      reporter_total_completed_returns: successfulReturns,
      reporter_total_reports_received: reportsReceived,
      reporter_badges: getBadgePayload({
        return_badge: returnBadge,
        warning_badge: warningBadge,
      }),
    });
  });
});

// fetch pending items for admin review

app.get("/admin/items/pending", authMiddleware, (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }
  const sql = ` SELECT 
      items.id,
      items.item_type,
      items.title,
      items.description,
      items.created_at,
      categories.name AS category,
      locations.name AS location,
      users.id AS reported_by_id,
      users.full_name AS reported_by
    FROM items
    JOIN categories ON items.category_id = categories.id
    JOIN locations ON items.location_id = locations.id
    JOIN users ON items.user_id = users.id
    JOIN item_statuses ON items.item_status_id = item_statuses.id
    WHERE item_statuses.status_name = 'pending'
    ORDER BY items.created_at ASC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Failed to fetch pending items" });
    }

    res.json(results);
  });
});

// sign up page

app.post("/signup", (req, res) => {
  const { fullName, email, phone, password } = req.body;

  if (!fullName || !email || !password) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  // Hash password
  bcrypt.hash(password, 10, (err, hashedPassword) => {
    if (err) {
      return res.status(500).json({ message: "Password hashing failed" });
    }

    const sql = `
      INSERT INTO users (full_name, email, phone, password)
      VALUES (?, ?, ?, ?)
    `;

    db.query(
      sql,
      [fullName, email, phone, hashedPassword],
      async (err, result) => {
        if (err) {
          if (err.code === "ER_DUP_ENTRY") {
            return res.status(409).json({ message: "Email already exists" });
          }
          return res.status(500).json({ message: "Database error" });
        }

        try {
          await ensureUserStatsRow(result.insertId);
        } catch (statsError) {
          console.error("Failed to initialize user stats:", statsError);
        }

        res.status(201).json({ message: "User registered successfully" });
      },
    );
  });
});

// login page

app.post("/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  const sql = "SELECT * FROM users WHERE email = ?";

  db.query(sql, [email], (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Database error" });
    }

    if (results.length === 0) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const user = results[0];

    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) {
        return res.status(500).json({ message: "Password comparison failed" });
      }

      if (!isMatch) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // 🔐 CREATE JWT
      const token = jwt.sign(
        {
          userId: user.id,
          role: user.role,
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN },
      );

      // Login success
      res.json({
        message: "Login successful",
        token,
        user: {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          phone: user.phone,
          coins: user.coins,
          role: user.role,
        },
      });
    });
  });
});

// upload page
// To be implemented: file upload handling using multer or similar middleware

app.post("/items", authMiddleware, upload.single("image"), async (req, res) => {
  console.log("→ POST /items");
  console.log("req.body:", req.body);
  console.log("req.file:", req.file ? req.file.filename : "no file");
  const user_id = req.user.userId; // 🔐 FROM TOKEN

  const {
    item_type,
    title,
    description,
    category_id,
    location_id,
    lost_date,
    found_date,
  } = req.body;

  if (!item_type || !title || !description || !category_id || !location_id) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const imageUrl = req.file ? `/uploads/items/${req.file.filename}` : null;
  let debitedForLostItem = false;

  try {
    if (item_type === "lost") {
      await adjustUserCoins(user_id, 10, "debit", `Posted lost item: ${title}`);
      debitedForLostItem = true;
    }

    const result = await queryAsync(
      `INSERT INTO items (user_id, item_type, title, description, category_id, location_id, lost_date, found_date, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id,
        item_type,
        title,
        description,
        category_id,
        location_id,
        lost_date || null,
        found_date || null,
        imageUrl,
      ],
    );

    let matchesFound = 0;

    try {
      const matchResult = await generateMatchesForItem(
        result.insertId,
        user_id,
      );
      matchesFound = matchResult.createdCount;
    } catch (matchError) {
      console.error("Match generation failed:", matchError);
    }

    await recalculateUserStats(user_id);

    console.log("Item uploaded with ID:", result.insertId);
    res.status(201).json({
      message: "Item uploaded successfully",
      item_id: result.insertId,
      matches_found: matchesFound,
    });
  } catch (error) {
    if (error.code === "INSUFFICIENT_COINS") {
      return res.status(400).json({
        message: "You need at least 10 coins to report a lost item",
      });
    }

    try {
      if (item_type === "lost" && debitedForLostItem) {
        await adjustUserCoins(
          user_id,
          10,
          "credit",
          `Refund for failed lost item upload: ${title}`,
        );
      }
    } catch (refundError) {
      console.error("Failed to refund lost-item upload coins:", refundError);
    }

    res.status(500).json({ message: "Failed to upload item", error });
  }
});

app.get("/matches", authMiddleware, async (req, res) => {
  try {
    const matches = await queryAsync(
      `SELECT
         m.id,
         m.match_status,
         m.confidence_score,
         m.created_at,
         ic.id AS claim_id,
         ic.status AS claim_status,
         ic.contact_shared,
         ic.delivered_confirmed,
         ic.received_confirmed,
         lost.id AS lost_item_id,
         lost.title AS lost_title,
         lost.description AS lost_description,
         lost.image_url AS lost_image_url,
         lost.lost_date,
         lc.name AS lost_category,
         ll.name AS lost_location,
         found.id AS found_item_id,
         found.title AS found_title,
         found.description AS found_description,
         found.image_url AS found_image_url,
         found.found_date,
         fc.name AS found_category,
         fl.name AS found_location,
         finder.full_name AS found_reported_by,
         (
           SELECT AVG(r.rating)
           FROM user_ratings r
           WHERE r.to_user = finder.id
         ) AS found_reporter_average_rating,
         (
           SELECT COUNT(*)
           FROM user_ratings r
           WHERE r.to_user = finder.id
         ) AS found_reporter_rating_count,
         (
           SELECT COUNT(*)
           FROM item_claims ic2
           JOIN items fi2 ON ic2.item_id = fi2.id
           WHERE fi2.user_id = finder.id
             AND fi2.item_type = 'found'
             AND ic2.status = 'completed'
         ) AS found_reporter_successful_returns,
         (
           (SELECT COUNT(*)
            FROM reported_items rp2
            JOIN items ri2 ON rp2.item_id = ri2.id
            WHERE ri2.user_id = finder.id)
           +
           (SELECT COUNT(*) FROM user_reports ur2 WHERE ur2.reported_user_id = finder.id)
         ) AS found_reporter_reports_received,
         COALESCE(rep_flags.warning_cleared, 0) AS found_reporter_warning_cleared
       FROM matches m
       JOIN items lost ON m.lost_item_id = lost.id
       JOIN items found ON m.found_item_id = found.id
       JOIN categories lc ON lost.category_id = lc.id
       JOIN locations ll ON lost.location_id = ll.id
       JOIN categories fc ON found.category_id = fc.id
       JOIN locations fl ON found.location_id = fl.id
       JOIN users finder ON found.user_id = finder.id
       LEFT JOIN user_reputation_flags rep_flags ON rep_flags.user_id = finder.id
       LEFT JOIN item_claims ic
         ON ic.item_id = found.id
        AND ic.claimant_id = lost.user_id
       WHERE lost.user_id = ?
       ORDER BY
         FIELD(m.match_status, 'confirmed', 'proposed', 'claimed', 'rejected'),
         m.created_at DESC`,
      [req.user.userId],
    );

    const uniqueMatches = Array.from(
      matches
        .reduce((accumulator, match) => {
          const key = String(match.found_item_id);
          const existingMatch = accumulator.get(key);

          if (!existingMatch) {
            accumulator.set(key, match);
            return accumulator;
          }

          const currentScore = Number(match.confidence_score || 0);
          const existingScore = Number(existingMatch.confidence_score || 0);

          if (
            currentScore > existingScore ||
            (currentScore === existingScore && Math.random() >= 0.5)
          ) {
            accumulator.set(key, match);
          }

          return accumulator;
        }, new Map())
        .values(),
    );

    const enrichedMatches = uniqueMatches.map((match) => {
      const successfulReturns = Number(
        match.found_reporter_successful_returns || 0,
      );
      const reportsReceived = Number(
        match.found_reporter_reports_received || 0,
      );
      const warningBadge =
        reportsReceived >= WARNING_REPORT_THRESHOLD &&
        !Boolean(match.found_reporter_warning_cleared);
      let returnBadge = null;
      if (successfulReturns >= 2) returnBadge = "green";
      else if (successfulReturns >= 1) returnBadge = "blue";

      return {
        ...match,
        found_reporter_badges: getBadgePayload({
          return_badge: returnBadge,
          warning_badge: warningBadge,
        }),
      };
    });

    res.json(enrichedMatches);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch matches" });
  }
});

app.get("/my-lost-items", authMiddleware, async (req, res) => {
  try {
    const items = await queryAsync(
      `SELECT
         items.id,
         items.title,
         items.description,
         items.lost_date,
         categories.name AS category,
         locations.name AS location
       FROM items
       JOIN categories ON items.category_id = categories.id
       JOIN locations ON items.location_id = locations.id
       JOIN item_statuses ON items.item_status_id = item_statuses.id
       WHERE items.user_id = ?
         AND items.item_type = 'lost'
         AND item_statuses.status_name NOT IN ('deleted', 'rejected', 'claimed', 'returned')
       ORDER BY items.created_at DESC`,
      [req.user.userId],
    );

    res.json(items);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch lost items" });
  }
});

app.post("/matches/:id/request-contact", authMiddleware, async (req, res) => {
  try {
    const results = await queryAsync(
      `SELECT
         m.id,
         m.match_status,
         lost.id AS lost_item_id,
         lost.title AS lost_title,
         lost.user_id AS lost_owner_id,
         found.id AS found_item_id,
         found.title AS found_title,
         found.user_id AS found_owner_id,
         lostOwner.full_name AS lost_owner_name
       FROM matches m
       JOIN items lost ON m.lost_item_id = lost.id
       JOIN items found ON m.found_item_id = found.id
       JOIN users lostOwner ON lost.user_id = lostOwner.id
       WHERE m.id = ?`,
      [req.params.id],
    );

    if (results.length === 0) {
      return res.status(404).json({ message: "Match not found" });
    }

    const match = results[0];

    if (match.lost_owner_id !== req.user.userId) {
      return res
        .status(403)
        .json({ message: "You cannot request this contact" });
    }

    if (match.match_status !== "proposed") {
      return res.status(409).json({
        message: "This match is no longer available for a new contact request",
      });
    }

    await queryAsync(
      "UPDATE matches SET match_status = 'confirmed' WHERE id = ?",
      [req.params.id],
    );
    await createOrUpdateClaim(match.found_item_id, req.user.userId, "pending");
    await recalculateUserStats(req.user.userId);

    await createNotification(
      match.found_owner_id,
      CONTACT_REQUEST_TITLE,
      `${match.lost_owner_name} believes your found item "${match.found_title}" may be their lost item "${match.lost_title}" and is requesting your contact details.`,
      match.found_item_id,
      match.id,
    );

    res.json({ message: "Contact request sent successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to send contact request" });
  }
});

app.post("/matches/:id/reject", authMiddleware, async (req, res) => {
  try {
    const results = await queryAsync(
      `SELECT m.id, m.match_status, lost.user_id AS lost_owner_id
       FROM matches m
       JOIN items lost ON m.lost_item_id = lost.id
       WHERE m.id = ?`,
      [req.params.id],
    );

    if (results.length === 0) {
      return res.status(404).json({ message: "Match not found" });
    }

    const match = results[0];

    if (match.lost_owner_id !== req.user.userId) {
      return res.status(403).json({ message: "You cannot update this match" });
    }

    if (match.match_status !== "proposed") {
      return res.status(409).json({
        message: "Only new proposed matches can be dismissed",
      });
    }

    await queryAsync(
      "UPDATE matches SET match_status = 'rejected' WHERE id = ?",
      [req.params.id],
    );

    res.json({ message: "Match dismissed" });
  } catch (error) {
    res.status(500).json({ message: "Failed to dismiss match" });
  }
});

app.post("/items/:id/suggest-match", authMiddleware, async (req, res) => {
  try {
    if (req.user.role === "admin") {
      return res.status(403).json({ message: "Admins cannot create claims" });
    }

    const { lost_item_id } = req.body;

    if (!lost_item_id) {
      return res.status(400).json({ message: "Lost item is required" });
    }

    const [lostItemCount] = await queryAsync(
      `SELECT COUNT(*) AS total
       FROM items
       WHERE user_id = ? AND item_type = 'lost'`,
      [req.user.userId],
    );

    if (!lostItemCount.total) {
      return res.status(400).json({
        message:
          "You need at least one lost item report before claiming a found item",
      });
    }

    const [foundItem] = await queryAsync(
      `SELECT
         items.id,
         items.user_id,
         items.item_type,
         items.title,
         items.description,
         items.category_id,
         items.location_id,
         items.found_date,
         items.image_url
       FROM items
       JOIN item_statuses ON items.item_status_id = item_statuses.id
       WHERE items.id = ?
         AND items.item_type = 'found'
         AND item_statuses.status_name NOT IN ('deleted', 'rejected', 'claimed', 'returned')`,
      [req.params.id],
    );

    if (!foundItem) {
      return res.status(404).json({ message: "Found item not found" });
    }

    if (foundItem.user_id === req.user.userId) {
      return res.status(400).json({
        message: "You cannot suggest your own found item as a match",
      });
    }

    const [lostItem] = await queryAsync(
      `SELECT
         items.id,
         items.user_id,
         items.item_type,
         items.title,
         items.description,
         items.category_id,
         items.location_id,
         items.lost_date
       FROM items
       JOIN item_statuses ON items.item_status_id = item_statuses.id
       WHERE items.id = ?
         AND items.user_id = ?
         AND items.item_type = 'lost'
         AND item_statuses.status_name NOT IN ('deleted', 'rejected', 'claimed', 'returned')`,
      [lost_item_id, req.user.userId],
    );

    if (!lostItem) {
      return res.status(404).json({ message: "Lost item not found" });
    }

    if (Number(lostItem.category_id) !== Number(foundItem.category_id)) {
      return res.status(400).json({
        message:
          "Your lost item must be in the same category as the found item",
      });
    }

    const confidenceScore = calculateMatchConfidence(lostItem, foundItem);

    if (confidenceScore < MATCH_SCORE_THRESHOLD - 10) {
      return res.status(400).json({
        message:
          "These items do not look similar enough yet. Try reporting more details first.",
      });
    }

    const existingMatches = await queryAsync(
      "SELECT id, match_status FROM matches WHERE lost_item_id = ? AND found_item_id = ?",
      [lostItem.id, foundItem.id],
    );

    let matchId;

    if (existingMatches.length > 0) {
      matchId = existingMatches[0].id;

      if (["confirmed", "claimed"].includes(existingMatches[0].match_status)) {
        return res.status(409).json({
          message: "A contact request already exists for this match",
        });
      }

      await queryAsync(
        `UPDATE matches
         SET match_status = 'confirmed',
             proposed_by = ?,
             confidence_score = ?
         WHERE id = ?`,
        [req.user.userId, confidenceScore, matchId],
      );
    } else {
      const insertResult = await queryAsync(
        `INSERT INTO matches (lost_item_id, found_item_id, match_status, proposed_by, confidence_score)
         VALUES (?, ?, 'confirmed', ?, ?)`,
        [lostItem.id, foundItem.id, req.user.userId, confidenceScore],
      );

      matchId = insertResult.insertId;
    }

    const [requester] = await queryAsync(
      "SELECT full_name FROM users WHERE id = ?",
      [req.user.userId],
    );

    await createNotification(
      foundItem.user_id,
      CONTACT_REQUEST_TITLE,
      `${requester.full_name} believes your found item "${foundItem.title}" may be their lost item "${lostItem.title}" and is requesting your contact details.`,
      foundItem.id,
      matchId,
    );
    await createOrUpdateClaim(foundItem.id, req.user.userId, "pending");
    await recalculateUserStats(req.user.userId);

    res.json({
      message: "Match suggestion sent successfully",
      match_id: matchId,
      match_status: "confirmed",
      confidence_score: confidenceScore,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to suggest a match" });
  }
});

app.get("/notifications", authMiddleware, async (req, res) => {
  try {
    const notifications = await queryAsync(
      `SELECT
         n.id,
         n.title,
         n.message,
         n.related_item_id,
         n.related_match_id,
         n.is_read,
         n.created_at,
         m.match_status,
         ic.id AS claim_id,
         ic.status AS claim_status,
         ic.contact_shared,
         ic.delivered_confirmed,
         ic.received_confirmed,
         lost.id AS lost_item_id,
         lost.title AS lost_title,
         lost.user_id AS lost_owner_id,
         found.id AS found_item_id,
         found.title AS found_title,
         found.user_id AS found_owner_id,
         claimant.id AS claimant_id,
         claimant.full_name AS claimant_name,
         (
           SELECT AVG(r.rating)
           FROM user_ratings r
           WHERE r.to_user = claimant.id
         ) AS claimant_rating,
         (
           SELECT COUNT(*)
           FROM user_ratings r
           WHERE r.to_user = claimant.id
         ) AS claimant_rating_count,
         (
           SELECT COUNT(*)
           FROM item_claims ic2
           WHERE ic2.claimant_id = claimant.id
         ) AS total_claims,
         (
           SELECT COUNT(*)
           FROM item_claims ic2
           WHERE ic2.claimant_id = claimant.id
             AND ic2.status = 'completed'
         ) AS successful_claims,
         (
           SELECT COUNT(*)
           FROM item_claims ic2
           WHERE ic2.claimant_id = claimant.id
             AND ic2.status = 'rejected'
         ) AS rejected_claims,
         (
           (SELECT COUNT(*)
            FROM reported_items rp2
            JOIN items ri2 ON rp2.item_id = ri2.id
            WHERE ri2.user_id = claimant.id)
           +
           (SELECT COUNT(*)
            FROM user_reports ur2
            WHERE ur2.reported_user_id = claimant.id)
         ) AS reports_received,
         (
           SELECT COUNT(*)
           FROM item_claims ic2
           JOIN items fi2 ON ic2.item_id = fi2.id
           WHERE fi2.user_id = claimant.id
             AND fi2.item_type = 'found'
             AND ic2.status = 'completed'
         ) AS claimant_successful_returns,
         COALESCE(claimant_flags.warning_cleared, 0) AS claimant_warning_cleared
       FROM notifications n
       LEFT JOIN matches m ON n.related_match_id = m.id
       LEFT JOIN items lost ON m.lost_item_id = lost.id
       LEFT JOIN items found ON m.found_item_id = found.id
       LEFT JOIN item_claims ic
         ON ic.item_id = found.id
        AND ic.claimant_id = lost.user_id
       LEFT JOIN users claimant ON claimant.id = lost.user_id
       LEFT JOIN user_reputation_flags claimant_flags ON claimant_flags.user_id = claimant.id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC`,
      [req.user.userId],
    );

    const mappedNotifications = notifications.map((notification) => {
      const successfulReturns = Number(notification.claimant_successful_returns || 0);
      const reportsReceived = Number(notification.reports_received || 0);
      const warningBadge =
        reportsReceived >= WARNING_REPORT_THRESHOLD &&
        !Boolean(notification.claimant_warning_cleared);
      let returnBadge = null;
      if (successfulReturns >= 2) returnBadge = "green";
      else if (successfulReturns >= 1) returnBadge = "blue";

      return {
        ...notification,
        claimant_badges: getBadgePayload({
          return_badge: returnBadge,
          warning_badge: warningBadge,
        }),
        share_contact_required:
          notification.title === CONTACT_REQUEST_TITLE &&
          notification.claim_status === "pending" &&
          Number(notification.found_owner_id) === Number(req.user.userId),
      };
    });

    res.json(mappedNotifications);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch notifications" });
  }
});

app.post("/notifications/:id/read", authMiddleware, async (req, res) => {
  try {
    const results = await queryAsync(
      "SELECT id FROM notifications WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.userId],
    );

    if (results.length === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    await queryAsync("UPDATE notifications SET is_read = 1 WHERE id = ?", [
      req.params.id,
    ]);

    res.json({ message: "Notification marked as read" });
  } catch (error) {
    res.status(500).json({ message: "Failed to update notification" });
  }
});

app.get("/wallet", authMiddleware, async (req, res) => {
  try {
    const [userWallet] = await queryAsync(
      "SELECT coins FROM users WHERE id = ?",
      [req.user.userId],
    );

    const transactions = await queryAsync(
      `SELECT id, amount, type, reason, created_at
       FROM coin_transactions
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.user.userId],
    );

    const paymentRequests = await queryAsync(
      `SELECT id, requested_coins, payment_method, payment_reference, status, created_at, reviewed_at
       FROM payment_requests
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.user.userId],
    );

    res.json({
      balance: userWallet?.coins || 0,
      transactions,
      payment_requests: paymentRequests,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to load wallet" });
  }
});

app.post("/payment-requests", authMiddleware, async (req, res) => {
  try {
    const { requested_coins, payment_method, payment_reference } = req.body;

    if (!requested_coins || !payment_method || !payment_reference) {
      return res.status(400).json({
        message: "Coins, payment method, and payment reference are required",
      });
    }

    const result = await queryAsync(
      `INSERT INTO payment_requests (user_id, requested_coins, payment_method, payment_reference)
       VALUES (?, ?, ?, ?)`,
      [req.user.userId, requested_coins, payment_method, payment_reference],
    );

    res.status(201).json({
      message: "Recharge request submitted successfully",
      request_id: result.insertId,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to submit recharge request" });
  }
});

app.post(
  "/notifications/:id/respond-contact-request",
  authMiddleware,
  async (req, res) => {
    try {
      const { decision, share_phone, share_email } = req.body;
      const results = await queryAsync(
        `SELECT
           n.id,
           n.user_id AS notification_owner_id,
           n.title,
           n.related_match_id,
           m.match_status,
           ic.id AS claim_id,
           ic.status AS claim_status,
           lost.id AS lost_item_id,
           lost.title AS lost_title,
           lost.user_id AS lost_owner_id,
           found.id AS found_item_id,
           found.title AS found_title,
           found.user_id AS found_owner_id,
           finder.full_name AS found_owner_name,
           finder.email AS found_owner_email,
           finder.phone AS found_owner_phone
         FROM notifications n
         JOIN matches m ON n.related_match_id = m.id
         JOIN items lost ON m.lost_item_id = lost.id
         JOIN items found ON m.found_item_id = found.id
         LEFT JOIN item_claims ic
           ON ic.item_id = found.id
          AND ic.claimant_id = lost.user_id
         JOIN users finder ON found.user_id = finder.id
         WHERE n.id = ?`,
        [req.params.id],
      );

      if (results.length === 0) {
        return res.status(404).json({ message: "Notification not found" });
      }

      const notification = results[0];

      if (
        notification.notification_owner_id !== req.user.userId ||
        notification.title !== CONTACT_REQUEST_TITLE ||
        notification.found_owner_id !== req.user.userId
      ) {
        return res
          .status(403)
          .json({ message: "You cannot respond to this request" });
      }

      if (notification.claim_status !== "pending") {
        return res.status(409).json({
          message: "This request has already been handled",
        });
      }

      if (!["accept", "decline"].includes(decision)) {
        return res.status(400).json({ message: "Invalid decision" });
      }

      if (decision === "accept" && !share_phone && !share_email) {
        return res.status(400).json({
          message: "Choose at least one contact option to share",
        });
      }

      if (decision === "accept") {
        const claimId =
          notification.claim_id ||
          (await createOrUpdateClaim(
            notification.found_item_id,
            notification.lost_owner_id,
            "contact_shared",
          ));

        await queryAsync(
          `UPDATE item_claims
           SET status = 'contact_shared',
               contact_shared = 1
           WHERE id = ?`,
          [claimId],
        );

        const sharedParts = [];

        if (share_phone) {
          sharedParts.push(`Phone: ${notification.found_owner_phone}`);
        }

        if (share_email) {
          sharedParts.push(`Email: ${notification.found_owner_email}`);
        }

        await createNotification(
          notification.lost_owner_id,
          CONTACT_SHARED_TITLE,
          `${notification.found_owner_name} shared contact details for the possible match "${notification.found_title}". ${sharedParts.join(" | ")} Please confirm after you both complete the offline handoff.`,
          notification.found_item_id,
          notification.related_match_id,
        );
      } else {
        await queryAsync(
          "UPDATE matches SET match_status = 'rejected' WHERE id = ?",
          [notification.related_match_id],
        );
        if (notification.claim_id) {
          await queryAsync(
            "UPDATE item_claims SET status = 'rejected' WHERE id = ?",
            [notification.claim_id],
          );
        } else {
          await createOrUpdateClaim(
            notification.found_item_id,
            notification.lost_owner_id,
            "rejected",
          );
        }

        await createNotification(
          notification.lost_owner_id,
          CONTACT_DECLINED_TITLE,
          `${notification.found_owner_name} declined to share contact details for the possible match "${notification.found_title}".`,
          notification.found_item_id,
          notification.related_match_id,
        );
      }

      await queryAsync("UPDATE notifications SET is_read = 1 WHERE id = ?", [
        req.params.id,
      ]);
      await recalculateUserStats(notification.lost_owner_id);
      await recalculateUserStats(notification.found_owner_id);

      res.json({
        message:
          decision === "accept"
            ? "Contact details shared successfully"
            : "Contact request declined",
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to process contact request" });
    }
  },
);

app.get("/claims/incoming", authMiddleware, async (req, res) => {
  try {
    const claims = await queryAsync(
      `SELECT
         ic.id AS claim_id,
         ic.status AS claim_status,
         ic.contact_shared,
         ic.delivered_confirmed,
         ic.received_confirmed,
         ic.created_at,
         m.id AS match_id,
         m.confidence_score,
         found.id AS found_item_id,
         found.title AS found_title,
         found.description AS found_description,
         found.image_url AS found_image_url,
         lost.id AS lost_item_id,
         lost.title AS lost_title,
         claimant.id AS claimant_id,
         claimant.full_name AS claimant_name,
         (
           SELECT AVG(r.rating)
           FROM user_ratings r
           WHERE r.to_user = claimant.id
         ) AS claimant_average_rating,
         (
           SELECT COUNT(*)
           FROM user_ratings r
           WHERE r.to_user = claimant.id
         ) AS claimant_rating_count,
         (
           SELECT COUNT(*)
           FROM item_claims ic2
           JOIN items fi2 ON ic2.item_id = fi2.id
           WHERE fi2.user_id = claimant.id
             AND fi2.item_type = 'found'
             AND ic2.status = 'completed'
         ) AS claimant_successful_returns,
         (
           (SELECT COUNT(*)
            FROM reported_items rp2
            JOIN items ri2 ON rp2.item_id = ri2.id
            WHERE ri2.user_id = claimant.id)
           +
           (SELECT COUNT(*) FROM user_reports ur2 WHERE ur2.reported_user_id = claimant.id)
         ) AS claimant_reports_received,
         COALESCE(claimant_flags.warning_cleared, 0) AS claimant_warning_cleared
       FROM item_claims ic
       JOIN items found ON ic.item_id = found.id
       JOIN matches m ON m.found_item_id = found.id
       JOIN items lost ON m.lost_item_id = lost.id
        AND lost.user_id = ic.claimant_id
       JOIN users claimant ON claimant.id = ic.claimant_id
       LEFT JOIN user_reputation_flags claimant_flags ON claimant_flags.user_id = claimant.id
       WHERE found.user_id = ?
       ORDER BY FIELD(ic.status, 'pending', 'contact_shared', 'in_progress', 'completed', 'rejected', 'expired'),
                ic.created_at DESC`,
      [req.user.userId],
    );

    const uniqueClaims = Array.from(
      claims
        .reduce((accumulator, claim) => {
          if (!accumulator.has(claim.claim_id)) {
            accumulator.set(claim.claim_id, claim);
          }

          return accumulator;
        }, new Map())
        .values(),
    ).map((claim) => {
      const successfulReturns = Number(claim.claimant_successful_returns || 0);
      const reportsReceived = Number(claim.claimant_reports_received || 0);
      const warningBadge =
        reportsReceived >= WARNING_REPORT_THRESHOLD &&
        !Boolean(claim.claimant_warning_cleared);
      let returnBadge = null;
      if (successfulReturns >= 2) returnBadge = "green";
      else if (successfulReturns >= 1) returnBadge = "blue";

      return {
        ...claim,
        claimant_badges: getBadgePayload({
          return_badge: returnBadge,
          warning_badge: warningBadge,
        }),
      };
    });

    res.json(uniqueClaims);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch incoming claims" });
  }
});

app.post("/claims/:id/share-contact", authMiddleware, async (req, res) => {
  try {
    const { share_phone, share_email } = req.body;
    const claim = await getClaimContextById(req.params.id);

    if (!claim) {
      return res.status(404).json({ message: "Claim not found" });
    }

    if (Number(claim.found_owner_id) !== Number(req.user.userId)) {
      return res
        .status(403)
        .json({ message: "Only the finder can share contact" });
    }

    if (claim.claim_status !== "pending") {
      return res
        .status(409)
        .json({ message: "This claim has already moved forward" });
    }

    if (!share_phone && !share_email) {
      return res
        .status(400)
        .json({ message: "Choose at least one contact option to share" });
    }

    const [finder] = await queryAsync(
      "SELECT full_name, email, phone FROM users WHERE id = ?",
      [req.user.userId],
    );

    const sharedParts = [];
    if (share_phone) sharedParts.push(`Phone: ${finder.phone}`);
    if (share_email) sharedParts.push(`Email: ${finder.email}`);

    await queryAsync(
      `UPDATE item_claims
       SET status = 'contact_shared',
           contact_shared = 1
       WHERE id = ?`,
      [req.params.id],
    );

    await createNotification(
      claim.lost_owner_id,
      CONTACT_SHARED_TITLE,
      `${finder.full_name} shared contact details for the possible match "${claim.found_title}". ${sharedParts.join(" | ")} Please confirm after the handoff is completed.`,
      claim.found_item_id,
      claim.match_id,
    );

    await recalculateUserStats(claim.lost_owner_id);
    await recalculateUserStats(claim.found_owner_id);

    res.json({ message: "Contact details shared successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to share contact details" });
  }
});

app.post("/claims/:id/confirm-delivered", authMiddleware, async (req, res) => {
  try {
    const claim = await getClaimContextById(req.params.id);

    if (!claim) {
      return res.status(404).json({ message: "Claim not found" });
    }

    if (Number(claim.found_owner_id) !== Number(req.user.userId)) {
      return res
        .status(403)
        .json({ message: "Only the finder can confirm delivery" });
    }

    if (!["contact_shared", "in_progress"].includes(claim.claim_status)) {
      return res
        .status(409)
        .json({ message: "This claim cannot be updated right now" });
    }

    await queryAsync(
      `UPDATE item_claims
       SET delivered_confirmed = 1,
           status = CASE WHEN received_confirmed = 1 THEN 'completed' ELSE 'in_progress' END
       WHERE id = ?`,
      [req.params.id],
    );

    await createNotification(
      claim.lost_owner_id,
      CLAIM_UPDATE_TITLE,
      `${claim.finder_name} marked the item "${claim.found_title}" as delivered.`,
      claim.found_item_id,
      claim.match_id,
    );

    const updatedClaim = await markClaimCompletedIfReady(req.params.id);

    res.json({
      message:
        updatedClaim?.claim_status === "completed"
          ? "Claim completed successfully"
          : "Delivery confirmation saved",
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to confirm delivery" });
  }
});

app.post("/claims/:id/confirm-received", authMiddleware, async (req, res) => {
  try {
    const claim = await getClaimContextById(req.params.id);

    if (!claim) {
      return res.status(404).json({ message: "Claim not found" });
    }

    if (Number(claim.lost_owner_id) !== Number(req.user.userId)) {
      return res
        .status(403)
        .json({ message: "Only the claimant can confirm receipt" });
    }

    if (!["contact_shared", "in_progress"].includes(claim.claim_status)) {
      return res
        .status(409)
        .json({ message: "This claim cannot be updated right now" });
    }

    await queryAsync(
      `UPDATE item_claims
       SET received_confirmed = 1,
           status = CASE WHEN delivered_confirmed = 1 THEN 'completed' ELSE 'in_progress' END
       WHERE id = ?`,
      [req.params.id],
    );

    await createNotification(
      claim.found_owner_id,
      CLAIM_UPDATE_TITLE,
      `${claim.claimant_name} confirmed they received the item "${claim.found_title}".`,
      claim.found_item_id,
      claim.match_id,
    );

    const updatedClaim = await markClaimCompletedIfReady(req.params.id);

    res.json({
      message:
        updatedClaim?.claim_status === "completed"
          ? "Claim completed successfully"
          : "Receipt confirmation saved",
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to confirm receipt" });
  }
});

app.post("/claims/:id/reject", authMiddleware, async (req, res) => {
  try {
    const claim = await getClaimContextById(req.params.id);

    if (!claim) {
      return res.status(404).json({ message: "Claim not found" });
    }

    const actorIsClaimant =
      Number(claim.lost_owner_id) === Number(req.user.userId);
    const actorIsFinder =
      Number(claim.found_owner_id) === Number(req.user.userId);

    if (!actorIsClaimant && !actorIsFinder) {
      return res.status(403).json({ message: "You cannot update this claim" });
    }

    if (["completed", "rejected", "expired"].includes(claim.claim_status)) {
      return res.status(409).json({ message: "This claim is already closed" });
    }

    await queryAsync(
      "UPDATE item_claims SET status = 'rejected' WHERE id = ?",
      [req.params.id],
    );
    await queryAsync(
      "UPDATE matches SET match_status = 'rejected' WHERE id = ?",
      [claim.match_id],
    );

    await createNotification(
      actorIsClaimant ? claim.found_owner_id : claim.lost_owner_id,
      CLAIM_UPDATE_TITLE,
      actorIsClaimant
        ? `${claim.claimant_name} marked the claim for "${claim.found_title}" as not their item.`
        : `${claim.finder_name} marked the claim for "${claim.found_title}" as invalid.`,
      claim.found_item_id,
      claim.match_id,
    );

    await recalculateUserStats(claim.lost_owner_id);
    await recalculateUserStats(claim.found_owner_id);

    res.json({ message: "Claim closed" });
  } catch (error) {
    res.status(500).json({ message: "Failed to close claim" });
  }
});

app.post("/claims/:id/report-user", authMiddleware, async (req, res) => {
  try {
    const { reason, description } = req.body;
    const claim = await getClaimContextById(req.params.id);

    if (!claim) {
      return res.status(404).json({ message: "Claim not found" });
    }

    if (
      !["contact_shared", "in_progress", "completed"].includes(
        claim.claim_status,
      )
    ) {
      return res
        .status(409)
        .json({ message: "You can report a user only after contact sharing" });
    }

    const actorIsClaimant =
      Number(claim.lost_owner_id) === Number(req.user.userId);
    const actorIsFinder =
      Number(claim.found_owner_id) === Number(req.user.userId);

    if (!actorIsClaimant && !actorIsFinder) {
      return res
        .status(403)
        .json({ message: "You cannot report for this claim" });
    }

    if (!reason || !description) {
      return res
        .status(400)
        .json({ message: "Reason and description are required" });
    }

    const reportedUserId = actorIsClaimant
      ? claim.found_owner_id
      : claim.lost_owner_id;

    await queryAsync(
      `INSERT INTO user_reports (reported_user_id, reported_by, reason, description)
       VALUES (?, ?, ?, ?)`,
      [reportedUserId, req.user.userId, reason, description],
    );
    await recalculateUserStats(req.user.userId);
    await recalculateUserStats(reportedUserId);
    await maybeAssignWarningBadge(reportedUserId);

    res.json({ message: "User reported successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to report user" });
  }
});

app.post("/claims/:id/rate-user", authMiddleware, async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const claim = await getClaimContextById(req.params.id);

    if (!claim) {
      return res.status(404).json({ message: "Claim not found" });
    }

    if (claim.claim_status !== "completed") {
      return res
        .status(409)
        .json({ message: "Ratings are available only after completion" });
    }

    const actorIsClaimant =
      Number(claim.lost_owner_id) === Number(req.user.userId);
    const actorIsFinder =
      Number(claim.found_owner_id) === Number(req.user.userId);

    if (!actorIsClaimant && !actorIsFinder) {
      return res.status(403).json({ message: "You cannot rate this claim" });
    }

    const toUser = actorIsClaimant ? claim.found_owner_id : claim.lost_owner_id;
    const existing = await queryAsync(
      "SELECT id FROM user_ratings WHERE from_user = ? AND to_user = ?",
      [req.user.userId, toUser],
    );

    if (existing.length > 0) {
      return res.status(409).json({ message: "You already rated this user" });
    }

    await queryAsync(
      `INSERT INTO user_ratings (from_user, to_user, rating, comment)
       VALUES (?, ?, ?, ?)`,
      [req.user.userId, toUser, rating, comment || null],
    );

    res.json({ message: "Rating submitted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to submit rating" });
  }
});

// EDIT ITEM (owner or admin only)
app.put("/items/:id", authMiddleware, (req, res) => {
  const itemId = req.params.id;
  const userId = req.user.userId;
  const role = req.user.role;

  const {
    title,
    description,
    category_id,
    location_id,
    lost_date,
    found_date,
  } = req.body;

  // Step 1: fetch the item
  db.query(
    "SELECT user_id, image_url FROM items WHERE id = ?",
    [itemId],
    (err, results) => {
      if (err) {
        return res.status(500).json({ message: "Database error" });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: "Item not found" });
      }

      const itemOwnerId = results[0].user_id;
      const itemImageUrl = results[0].image_url;

      // Step 2: permission check
      if (itemOwnerId !== userId && role !== "admin") {
        return res.status(403).json({
          message: "You are not allowed to edit this item",
        });
      }

      // Step 3: update item
      const updateSql = ` UPDATE items
        SET
          title = ?,
          description = ?,
          category_id = ?,
          location_id = ?,
          lost_date = ?,
          found_date = ?
        WHERE id = ?
      `;

      db.query(
        updateSql,
        [
          title,
          description,
          category_id,
          location_id,
          lost_date || null,
          found_date || null,
          itemId,
        ],
        (err) => {
          if (err) {
            return res.status(500).json({ message: "Failed to update item" });
          }

          res.json({ message: "Item updated successfully" });
        },
      );
    },
  );
});

// DELETE ITEM (owner or admin only)

app.delete("/items/:id", authMiddleware, async (req, res) => {
  const itemId = req.params.id;
  const userId = req.user.userId;
  const role = req.user.role;

  console.log(
    `[DELETE /items/${itemId}] started by user=${userId}, role=${role}`,
  );

  try {
    const items = await queryAsync(
      "SELECT user_id, image_url FROM items WHERE id = ?",
      [itemId],
    );

    if (!items.length) {
      return res.status(404).json({ message: "Item not found" });
    }

    const itemOwnerId = Number(items[0].user_id);
    const itemImageUrl = items[0].image_url;

    if (itemOwnerId !== Number(userId) && role !== "admin") {
      return res.status(403).json({
        message: "You are not allowed to delete this item",
      });
    }

    await queryAsync("START TRANSACTION");
    console.log(`[DELETE /items/${itemId}] transaction started`);

    const matchRows = await queryAsync(
      `SELECT id
       FROM matches
       WHERE lost_item_id = ?
          OR found_item_id = ?`,
      [itemId, itemId],
    );
    const matchIds = matchRows.map((match) => match.id);

    if (matchIds.length) {
      const matchPlaceholders = matchIds.map(() => "?").join(", ");

      await queryAsync(
        `DELETE FROM notifications
         WHERE related_match_id IN (${matchPlaceholders})`,
        matchIds,
      );
      console.log(
        `[DELETE /items/${itemId}] removed notifications for ${matchIds.length} match record(s)`,
      );
    }

    await queryAsync(
      "DELETE FROM notifications WHERE related_item_id = ?",
      [itemId],
    );
    console.log(`[DELETE /items/${itemId}] removed item notifications`);

    await queryAsync(
      "DELETE FROM item_claims WHERE item_id = ?",
      [itemId],
    );
    console.log(`[DELETE /items/${itemId}] removed related item_claims`);

    await queryAsync(
      "DELETE FROM reported_items WHERE item_id = ?",
      [itemId],
    );
    console.log(`[DELETE /items/${itemId}] removed related reported_items`);

    await queryAsync(
      "DELETE FROM matches WHERE lost_item_id = ? OR found_item_id = ?",
      [itemId, itemId],
    );
    console.log(`[DELETE /items/${itemId}] removed related matches`);

    await queryAsync("DELETE FROM item_history WHERE item_id = ?", [itemId]);
    console.log(`[DELETE /items/${itemId}] removed related item_history rows`);

    await queryAsync("DELETE FROM items WHERE id = ?", [itemId]);
    console.log(`[DELETE /items/${itemId}] item row deleted`);

    await queryAsync("COMMIT");
    console.log(`[DELETE /items/${itemId}] transaction committed`);

    if (itemImageUrl) {
      console.log(
        `[DELETE /items/${itemId}] deleting image: ${itemImageUrl}`,
      );
    } else {
      console.log(`[DELETE /items/${itemId}] no image to delete`);
    }

    try {
      await removeItemImage(itemImageUrl);
      console.log(`[DELETE /items/${itemId}] image delete step finished`);
    } catch (imageError) {
      console.error(
        `[DELETE /items/${itemId}] image delete failed:`,
        imageError,
      );
    }

    if (role === "admin") {
      queryAsync(
        `INSERT INTO admin_actions (admin_id, action_type, target_id, target_type, details)
         VALUES (?, 'delete_item', ?, 'item', ?)`,
        [userId, itemId, `Admin deleted item ID ${itemId}`],
      ).catch((logError) => {
        console.error(
          `[DELETE /items/${itemId}] failed to write admin action:`,
          logError,
        );
      });

      queryAsync(
        `INSERT INTO item_history (item_id, user_id, action, old_value, new_value)
         VALUES (?, ?, 'deleted', NULL, 'item removed')`,
        [itemId, userId],
      ).catch((historyError) => {
        console.error(
          `[DELETE /items/${itemId}] failed to write item history:`,
          historyError,
        );
      });
    }

    return res.json({ message: "Item deleted successfully" });
  } catch (error) {
    try {
      await queryAsync("ROLLBACK");
      console.log(`[DELETE /items/${itemId}] transaction rolled back`);
    } catch (rollbackError) {
      console.error(
        `[DELETE /items/${itemId}] rollback failed:`,
        rollbackError,
      );
    }

    console.error(`[DELETE /items/${itemId}] failed:`, error);
    return res.status(500).json({ message: "Failed to delete item" });
  }
});
// admin item verification

app.post("/admin/items/verify", authMiddleware, async (req, res) => {
  const { item_id, action, rejection_reason } = req.body;

  const adminId = req.user.userId;
  const role = req.user.role;

  if (role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }

  if (!item_id || !action) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  if (!["verified", "rejected"].includes(action)) {
    return res.status(400).json({ message: "Invalid action" });
  }

  if (action === "rejected" && !String(rejection_reason || "").trim()) {
    return res.status(400).json({ message: "Rejection reason is required" });
  }

  try {
    const [statusRow] = await queryAsync(
      "SELECT id FROM item_statuses WHERE status_name = ?",
      [action],
    );

    if (!statusRow) {
      return res.status(500).json({ message: "Invalid status" });
    }

    const [itemRow] = await queryAsync(
      "SELECT id, user_id, title FROM items WHERE id = ?",
      [item_id],
    );

    if (!itemRow) {
      return res.status(404).json({ message: "Item not found" });
    }

    await queryAsync(
      `UPDATE items
       SET item_status_id = ?,
           is_verified = ?,
           verified_by = ?,
           verified_at = NOW(),
           rejection_reason = ?
       WHERE id = ?`,
      [
        statusRow.id,
        action === "verified" ? 1 : 0,
        adminId,
        action === "rejected" ? String(rejection_reason).trim() : null,
        item_id,
      ],
    );

    await queryAsync(
      `INSERT INTO admin_actions (admin_id, action_type, target_id, target_type, details)
       VALUES (?, ?, ?, 'item', ?)`,
      [
        adminId,
        action,
        item_id,
        action === "rejected"
          ? `Rejected item with reason: ${String(rejection_reason).trim()}`
          : "Verified item",
      ],
    );

    if (action === "rejected") {
      await createNotification(
        itemRow.user_id,
        ITEM_REJECTED_TITLE,
        `Your item "${itemRow.title}" was rejected. Reason: ${String(rejection_reason).trim()}`,
        item_id,
      );
    }

    res.json({ message: `Item ${action} successfully` });
  } catch (error) {
    res.status(500).json({ message: "Failed to update item" });
  }
});

// report item

app.post("/items/:itemId/report", authMiddleware, async (req, res) => {
  try {
    if (req.user.role === "admin") {
      return res.status(403).json({ message: "Admins cannot report items" });
    }

    const itemId = req.params.itemId;
    const reportedBy = req.user.userId;
    const { reason, description } = req.body;

    if (!reason || !description || description.trim().length < 10) {
      return res.status(400).json({
        message: "Choose a reason and provide at least 10 characters of detail",
      });
    }

    const items = await queryAsync(
      `SELECT items.id, items.user_id, items.title
       FROM items
       JOIN item_statuses ON items.item_status_id = item_statuses.id
       WHERE items.id = ?
         AND item_statuses.status_name NOT IN ('deleted', 'rejected', 'claimed', 'returned')`,
      [itemId],
    );

    if (items.length === 0) {
      return res.status(404).json({ message: "Item not found" });
    }

    if (items[0].user_id === reportedBy) {
      return res.status(400).json({
        message: "You cannot report your own item",
      });
    }

    const insertResult = await queryAsync(
      `INSERT INTO reported_items (item_id, reported_by, reason, description)
       VALUES (?, ?, ?, ?)`,
      [itemId, reportedBy, reason, description.trim()],
    );
    await recalculateUserStats(reportedBy);
    await recalculateUserStats(items[0].user_id);
    await maybeAssignWarningBadge(items[0].user_id);

    res.status(201).json({
      message: "Item reported successfully",
      report_id: insertResult.insertId,
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res
        .status(409)
        .json({ message: "You already reported this item" });
    }

    res.status(500).json({ message: "Failed to report item" });
  }
});

// admin view reported items

app.get("/admin/reported-items", authMiddleware, async (req, res) => {
  // Only admins allowed
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }

  const pagination = getPaginationParams(req.query, 10);
  const sql = `SELECT
      ri.id AS report_id,
      ri.reason,
      ri.description,
      ri.status,
      ri.created_at AS reported_at,
      ri.reviewed_at,
      ri.admin_note,

      i.id AS item_id,
      i.title,
      i.item_type,

      reporter.full_name AS reported_by,
      reporter.id AS reported_by_id,
      owner.full_name AS item_owner,
      owner.id AS item_owner_id,
      reviewer.full_name AS reviewed_by

    FROM reported_items ri
    JOIN items i ON ri.item_id = i.id
    JOIN users reporter ON ri.reported_by = reporter.id
    JOIN users owner ON i.user_id = owner.id
    LEFT JOIN users reviewer ON ri.reviewed_by = reviewer.id

    ORDER BY ri.created_at DESC
    LIMIT ? OFFSET ?
  `;

  try {
    const results = await queryAsync(sql, [
      pagination.limit,
      pagination.offset,
    ]);
    const [countResult] = await queryAsync(
      "SELECT COUNT(*) AS total FROM reported_items",
    );

    res.json({
      reports: results,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: countResult.total,
        total_pages: Math.max(
          Math.ceil(countResult.total / pagination.limit),
          1,
        ),
      },
    });
  } catch (err) {
    res.status(500).json({
      message: "Failed to fetch reported items",
      error: err,
    });
  }
});

// admin take action on reported item

app.post("/admin/reports/action", authMiddleware, (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }

  const adminId = req.user.userId;
  const { report_id, action, admin_note } = req.body;

  if (!report_id || !["ignore", "delete"].includes(action)) {
    return res.status(400).json({ message: "Invalid request" });
  }

  // 1. Get report info
  const getReportSql = `SELECT item_id
    FROM reported_items
    WHERE id = ? AND status = 'pending'
  `;

  db.query(getReportSql, [report_id], (err, reportResult) => {
    if (err || reportResult.length === 0) {
      return res
        .status(404)
        .json({ message: "Report not found or already handled" });
    }

    const itemId = reportResult[0].item_id;

    // 2. If action = delete → mark item as deleted
    if (action === "delete") {
      const deleteItemSql = `UPDATE items
        SET item_status_id = (
          SELECT id FROM item_statuses WHERE status_name = 'deleted'
        )
        WHERE id = ?
      `;

      db.query(deleteItemSql, [itemId], (err) => {
        if (err) {
          return res.status(500).json({ message: "Failed to delete item" });
        }

        logAdminActionAndResolveReport();
      });
    } else {
      // ignore
      logAdminActionAndResolveReport();
    }

    // 3. Update report + log admin action
    function logAdminActionAndResolveReport() {
      const updateReportSql = `UPDATE reported_items
        SET
          status = ?,
          reviewed_by = ?,
          reviewed_at = NOW(),
          admin_note = ?
        WHERE id = ?
      `;

      const reportStatus = action === "delete" ? "resolved" : "dismissed";

      db.query(
        updateReportSql,
        [reportStatus, adminId, admin_note || null, report_id],
        (err) => {
          if (err) {
            return res.status(500).json({ message: "Failed to update report" });
          }

          // Log admin action
          db.query(
            `INSERT INTO admin_actions (admin_id, action_type, target_id, target_type, details)
            VALUES (?, ?, ?, 'item', ?)`,
            [
              adminId,
              action === "delete" ? "delete_item" : "ignore_report",
              itemId,
              admin_note || null,
            ],
          );

          res.json({
            message:
              action === "delete"
                ? "Item deleted and report resolved"
                : "Report dismissed successfully",
          });
        },
      );
    }
  });
});

// admin dashboard stats

app.get("/admin/stats", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin only" });
  }

  try {
    const [itemTotals] = await queryAsync(
      `SELECT
         COUNT(*) AS total_items,
         SUM(CASE WHEN item_statuses.status_name = 'pending' THEN 1 ELSE 0 END) AS pending_items,
         SUM(CASE WHEN items.is_verified = 1 THEN 1 ELSE 0 END) AS verified_items
       FROM items
       JOIN item_statuses ON items.item_status_id = item_statuses.id
       WHERE item_statuses.status_name != 'deleted'`,
    );

    const [userTotals] = await queryAsync(
      "SELECT COUNT(*) AS total_users FROM users WHERE role = 'user'",
    );

    const [reportTotals] = await queryAsync(
      "SELECT COUNT(*) AS pending_reports FROM reported_items WHERE status = 'pending'",
    );

    const [matchTotals] = await queryAsync(
      "SELECT COUNT(*) AS claimed_items FROM item_claims WHERE status = 'completed'",
    );

    const [inProgressClaims] = await queryAsync(
      `SELECT COUNT(*) AS in_progress_claims
       FROM item_claims
       WHERE status IN ('contact_shared', 'in_progress')`,
    );

    res.json({
      total_items: itemTotals.total_items || 0,
      pending_items: itemTotals.pending_items || 0,
      verified_items: itemTotals.verified_items || 0,
      total_users: userTotals.total_users || 0,
      pending_reports: reportTotals.pending_reports || 0,
      claimed_items: matchTotals.claimed_items || 0,
      in_progress_claims: inProgressClaims.in_progress_claims || 0,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to load admin stats" });
  }
});

// admin view logs

app.get("/admin/logs", authMiddleware, (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin only" });
  }

  const sql = `
    SELECT 
      aa.id,
      aa.action_type,
      aa.target_id,
      aa.target_type,
      aa.details,
      aa.created_at,
      u.id AS admin_user_id,
      u.full_name AS admin_name
    FROM admin_actions aa
    JOIN users u ON aa.admin_id = u.id
    ORDER BY aa.created_at DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Failed to fetch logs" });
    }

    res.json(results);
  });
});

app.get("/admin/payment-requests", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin only" });
  }

  try {
    const requests = await queryAsync(
      `SELECT
         payment_requests.id,
         payment_requests.user_id,
         payment_requests.requested_coins,
         payment_requests.payment_method,
         payment_requests.payment_reference,
         payment_requests.status,
         payment_requests.created_at,
         users.full_name AS user_name
       FROM payment_requests
       JOIN users ON payment_requests.user_id = users.id
       ORDER BY payment_requests.created_at DESC`,
    );

    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch payment requests" });
  }
});

app.get("/admin/claims", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin only" });
  }

  try {
    const statusGroup = req.query.group || "in_progress";

    let statusFilter = "ic.status IN ('contact_shared', 'in_progress')";
    if (statusGroup === "completed") {
      statusFilter = "ic.status = 'completed'";
    }

    const claims = await queryAsync(
      `SELECT
         ic.id AS claim_id,
         ic.status AS claim_status,
         ic.contact_shared,
         ic.delivered_confirmed,
         ic.received_confirmed,
         ic.created_at,
         found.id AS found_item_id,
         found.title AS found_title,
         lost.id AS lost_item_id,
         lost.title AS lost_title,
         finder.id AS finder_id,
         finder.full_name AS finder_name,
         claimant.id AS claimant_id,
         claimant.full_name AS claimant_name,
         (
           SELECT AVG(r.rating)
           FROM user_ratings r
           WHERE r.to_user = claimant.id
         ) AS claimant_average_rating,
         (
           SELECT COUNT(*)
           FROM user_ratings r
           WHERE r.to_user = claimant.id
         ) AS claimant_rating_count,
         (
           SELECT AVG(r.rating)
           FROM user_ratings r
           WHERE r.to_user = finder.id
         ) AS finder_average_rating,
         (
           SELECT COUNT(*)
           FROM user_ratings r
           WHERE r.to_user = finder.id
         ) AS finder_rating_count
       FROM item_claims ic
       JOIN items found ON ic.item_id = found.id
       JOIN matches m ON m.found_item_id = found.id
       JOIN items lost ON m.lost_item_id = lost.id AND lost.user_id = ic.claimant_id
       JOIN users finder ON finder.id = found.user_id
       JOIN users claimant ON claimant.id = ic.claimant_id
       WHERE ${statusFilter}
      ORDER BY ic.created_at DESC`,
    );

    const uniqueClaims = Array.from(
      claims
        .reduce((accumulator, claim) => {
          if (!accumulator.has(claim.claim_id)) {
            accumulator.set(claim.claim_id, claim);
          }

          return accumulator;
        }, new Map())
        .values(),
    );

    const userIds = Array.from(
      new Set(
        uniqueClaims.flatMap((claim) => [claim.claimant_id, claim.finder_id]),
      ),
    );
    const summaryEntries = await Promise.all(
      userIds.map(async (id) => [id, await getUserReputationSummary(id)]),
    );
    const summaryMap = Object.fromEntries(summaryEntries);

    const enrichedClaims = uniqueClaims.map((claim) => ({
      ...claim,
      claimant_badges: summaryMap[claim.claimant_id]?.badges || [],
      finder_badges: summaryMap[claim.finder_id]?.badges || [],
    }));

    res.json(enrichedClaims);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch claims" });
  }
});

app.get("/admin/suspicious-users", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin only" });
  }

  try {
    const users = await queryAsync(
      `SELECT
         u.id,
         u.full_name,
         u.email,
         u.trust_score,
         COALESCE(flags.warning_cleared, 0) AS warning_cleared,
         COALESCE(stats.total_claims, 0) AS total_claims,
         COALESCE(stats.reports_received, 0) AS reports_received,
         COALESCE(claims.failed_claims, 0) AS failed_claims,
         COALESCE(claims.completed_claims, 0) AS completed_claims
       FROM users u
       LEFT JOIN user_reputation_flags flags ON flags.user_id = u.id
       LEFT JOIN user_stats stats ON stats.user_id = u.id
       LEFT JOIN (
         SELECT
           claimant_id,
           SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS failed_claims,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_claims
         FROM item_claims
         GROUP BY claimant_id
       ) claims ON claims.claimant_id = u.id
       WHERE u.role = 'user'
       ORDER BY
         (COALESCE(claims.failed_claims, 0) * 3 + COALESCE(stats.reports_received, 0) * 2 + (100 - u.trust_score)) DESC,
         u.full_name ASC`,
    );

    const suspiciousUsers = users
      .map((entry) => {
        const totalResolved = entry.failed_claims + entry.completed_claims;
        const successRate = totalResolved
          ? Math.round((entry.completed_claims / totalResolved) * 100)
          : 100;

        return {
          ...entry,
          success_rate: successRate,
          warning_badge:
            entry.reports_received >= WARNING_REPORT_THRESHOLD &&
            !Boolean(entry.warning_cleared),
          is_suspicious:
            entry.failed_claims >= 3 ||
            entry.reports_received >= 3 ||
            (totalResolved >= 3 && successRate < 40) ||
            entry.trust_score < 35 ||
            (entry.reports_received >= WARNING_REPORT_THRESHOLD &&
              !Boolean(entry.warning_cleared)),
        };
      })
      .filter((entry) => entry.is_suspicious);

    res.json(suspiciousUsers);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch suspicious users" });
  }
});

app.post("/admin/users/:id/mark-safe", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin only" });
  }

  try {
    const targetUserId = Number(req.params.id);
    await ensureUserReputationFlagRow(targetUserId);

    await queryAsync(
      `UPDATE user_reputation_flags
       SET warning_cleared = 1,
           warning_notified = 0,
           warning_cleared_by = ?
       WHERE user_id = ?`,
      [req.user.userId, targetUserId],
    );

    await createNotification(
      targetUserId,
      WARNING_BADGE_REMOVED_TITLE,
      "Your warning badge was removed after admin review.",
    );

    res.json({ message: "User marked as safe successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to mark user as safe" });
  }
});

app.post("/badges/appeal", authMiddleware, async (req, res) => {
  try {
    const reason = String(req.body.reason || "").trim();
    if (!reason) {
      return res.status(400).json({ message: "Appeal reason is required" });
    }

    const reputation = await getUserReputationSummary(req.user.userId);
    if (!reputation.warning_badge) {
      return res.status(409).json({ message: "No active warning badge to appeal" });
    }

    const [existingAppeal] = await queryAsync(
      `SELECT id
       FROM badge_appeals
       WHERE user_id = ?
         AND badge_type = 'warning'
         AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`,
      [req.user.userId],
    );

    if (existingAppeal) {
      return res.status(409).json({ message: "You already have a pending appeal" });
    }

    await queryAsync(
      `INSERT INTO badge_appeals (user_id, badge_type, reason)
       VALUES (?, 'warning', ?)`,
      [req.user.userId, reason],
    );

    res.status(201).json({ message: "Appeal submitted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to submit appeal" });
  }
});

app.post(
  "/admin/payment-requests/:id/review",
  authMiddleware,
  async (req, res) => {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin only" });
    }

    try {
      const { action, approved_coins } = req.body;
      const [requestRow] = await queryAsync(
        "SELECT * FROM payment_requests WHERE id = ?",
        [req.params.id],
      );

      if (!requestRow) {
        return res.status(404).json({ message: "Payment request not found" });
      }

      if (requestRow.status !== "pending") {
        return res
          .status(409)
          .json({ message: "This request has already been reviewed" });
      }

      if (!["approve", "reject"].includes(action)) {
        return res.status(400).json({ message: "Invalid action" });
      }

      if (action === "approve") {
        const coinAmount = Number(approved_coins || requestRow.requested_coins);

        await adjustUserCoins(
          requestRow.user_id,
          coinAmount,
          "credit",
          `Admin approved recharge request #${requestRow.id}`,
        );

        await queryAsync(
          `UPDATE payment_requests
         SET status = 'approved',
             admin_id = ?,
             requested_coins = ?,
             reviewed_at = NOW()
         WHERE id = ?`,
          [req.user.userId, coinAmount, req.params.id],
        );
      } else {
        await queryAsync(
          `UPDATE payment_requests
         SET status = 'rejected',
             admin_id = ?,
             reviewed_at = NOW()
         WHERE id = ?`,
          [req.user.userId, req.params.id],
        );
      }

      await queryAsync(
        `INSERT INTO admin_actions (admin_id, action_type, target_id, target_type, details)
       VALUES (?, ?, ?, 'user', ?)`,
        [
          req.user.userId,
          action === "approve" ? "approve_payment" : "reject_payment",
          req.params.id,
          action === "approve"
            ? `Approved recharge request with ${approved_coins || requestRow.requested_coins} coins`
            : "Rejected recharge request",
        ],
      );

      res.json({
        message:
          action === "approve"
            ? "Payment request approved"
            : "Payment request rejected",
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to review payment request" });
    }
  },
);

// admin manage users

app.get("/admin/users", authMiddleware, (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin only" });
  }

  db.query(
    `SELECT
       users.id,
       users.full_name,
       users.email,
       users.role,
       users.created_at,
       (
         SELECT AVG(r.rating)
         FROM user_ratings r
         WHERE r.to_user = users.id
       ) AS average_rating,
       (
         SELECT COUNT(*)
         FROM user_ratings r
         WHERE r.to_user = users.id
       ) AS rating_count,
       (
         SELECT COUNT(*)
         FROM item_claims ic
         JOIN items fi ON ic.item_id = fi.id
         WHERE fi.user_id = users.id
           AND fi.item_type = 'found'
           AND ic.status = 'completed'
       ) AS successful_returns,
       (
         (SELECT COUNT(*)
          FROM reported_items rp
          JOIN items ri ON rp.item_id = ri.id
          WHERE ri.user_id = users.id)
         +
         (SELECT COUNT(*)
          FROM user_reports ur
          WHERE ur.reported_user_id = users.id)
       ) AS reports_received,
       COALESCE(rep_flags.warning_cleared, 0) AS warning_cleared
     FROM users
     LEFT JOIN user_reputation_flags rep_flags ON rep_flags.user_id = users.id`,
    (err, results) => {
      if (err) {
        return res.status(500).json({ message: "Failed to fetch users" });
      }

      const enriched = results.map((entry) => {
        const successfulReturns = Number(entry.successful_returns || 0);
        const reportsReceived = Number(entry.reports_received || 0);
        const warningBadge =
          reportsReceived >= WARNING_REPORT_THRESHOLD &&
          !Boolean(entry.warning_cleared);
        let returnBadge = null;
        if (successfulReturns >= 2) returnBadge = "green";
        else if (successfulReturns >= 1) returnBadge = "blue";

        return {
          ...entry,
          badges: getBadgePayload({
            return_badge: returnBadge,
            warning_badge: warningBadge,
          }),
        };
      });

      res.json(enriched);
    },
  );
});

app.get("/admin/users/:id/details", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin only" });
  }

  try {
    await recalculateUserStats(req.params.id);

    const userRows = await queryAsync(
      `SELECT
         users.id,
         users.full_name,
         users.email,
         users.phone,
         users.coins,
         users.created_at,
         COALESCE(user_stats.total_uploaded, 0) AS total_uploaded,
         COALESCE(user_stats.total_claims, 0) AS total_claims,
         COALESCE(user_stats.successful_returns, 0) AS successful_returns,
         COALESCE(user_stats.reports_made, 0) AS reports_made,
         COALESCE(user_stats.reports_received, 0) AS reports_received
       FROM users
       LEFT JOIN user_stats ON users.id = user_stats.user_id
       WHERE users.id = ?`,
      [req.params.id],
    );

    if (userRows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const [uploadChart] = await queryAsync(
      `SELECT
         SUM(CASE WHEN item_type = 'lost' THEN 1 ELSE 0 END) AS lost_uploads,
         SUM(CASE WHEN item_type = 'found' THEN 1 ELSE 0 END) AS found_uploads
       FROM items
       WHERE user_id = ?`,
      [req.params.id],
    );

    const [claimChart] = await queryAsync(
      `SELECT
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_claims,
         SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_claims,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_claims,
         SUM(CASE WHEN status IN ('contact_shared', 'in_progress') THEN 1 ELSE 0 END) AS active_claims
       FROM item_claims
       WHERE claimant_id = ?`,
      [req.params.id],
    );

    const [ratings] = await queryAsync(
      `SELECT
         AVG(rating) AS average_rating,
         COUNT(*) AS rating_count
       FROM user_ratings
       WHERE to_user = ?`,
      [req.params.id],
    );

    const totalResolvedClaims =
      Number(claimChart.completed_claims || 0) +
      Number(claimChart.rejected_claims || 0);
    const successRate = totalResolvedClaims
      ? Math.round(
          (Number(claimChart.completed_claims || 0) / totalResolvedClaims) *
            100,
        )
      : 0;

    res.json({
      user: {
        ...userRows[0],
        claim_success_rate: successRate,
        average_rating: Number(ratings.average_rating || 0).toFixed(1),
        rating_count: ratings.rating_count || 0,
        failed_claims: claimChart.rejected_claims || 0,
      },
      charts: {
        uploads: uploadChart,
        claims: claimChart,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch user details" });
  }
});

// admin delete user

app.delete("/admin/users/:id", authMiddleware, (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin only" });
  }

  const userId = req.params.id;

  db.query("DELETE FROM users WHERE id = ?", [userId], (err) => {
    if (err) {
      return res.status(500).json({ message: "Delete failed" });
    }

    res.json({ message: "User deleted" });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


