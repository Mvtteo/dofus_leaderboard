# OGRE Prismes & Ressources - Admin Debt Tracker

## Overview
Bot tracks player purchases in dedicated channel. Extracts total kamas from screenshots. Admin panel manages pending validations with checkboxes and player filters. Images deleted after validation.

## User Flow

### Player (Buyer)
1. Posts screenshot in `#prismes-channel` with item list + prices
2. Bot recognition model extracts total kamas from image
3. Bot uploads image + data to DB (status: pending)
4. Bot confirms: "✓ Demande reçue. Notifié à validation." (message reaction)

### Validation (Admin Approves)
1. Admin uses `/admin-prismes view` to see all pending
2. Filters by player or checks specific demands (checkboxes)
3. Clicks "Validate selected" or "Clear all for [Player]"
4. On validation:
   - Mark request status = 'validated'
   - Set image_url = NULL (remove reference from DB)
   - Image file remains in storage (local or cloud) for later viewing
   - Bot posts channel mention: "@Player ✓ Demande(s) validée(s) par [Admin name]"

**Admin can still view images:**
- Archived requests show "View image" link
- Retrieves image from storage by record ID (image_id or filename pattern)
- No direct image_url in DB needed

## DB Schema

### Table: `prism_requests`
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PRIMARY KEY | Used to locate image in storage |
| player_name | VARCHAR(255) | Discord username |
| discord_user_id | BIGINT | Who posted |
| discord_message_id | BIGINT | Original message link |
| image_url | TEXT | Uploaded screenshot path (NULL after validation) |
| total_kamas | INTEGER | Sum of all items in screenshot |
| status | ENUM('pending', 'validated', 'rejected') | Admin action |
| created_at | TIMESTAMP | When posted |
| validated_at | TIMESTAMP | When admin approved |
| validated_by_admin | VARCHAR(255) | Admin name |

**Storage naming:** Images stored as `/prismes-uploads/{request_id}.{ext}` for easy retrieval

## API / Commands

### Discord Bot Commands

#### Channel Monitor
- Listen to `#prismes` (or configurable channel)
- On message with image attachment:
  1. Call existing recognition model → parse total kamas from image
  2. Extract player name from Discord message author
  3. INSERT into `prism_requests` table (status: pending)
  4. Upload image to storage (local `/prismes-uploads/` or cloud)
  5. Confirm message: react ✓ + ephemeral reply

#### Admin Command
```
/admin-prismes [action] [options]
- view: Show all pending (paginated table)
- view player:[name]: Show only this player's pending
- validate [request_ids]: Mark specific demands as paid + delete images
- clear-player [player]: Reject all pending from player
- history [player]: Show archived (validated/rejected)
```

## Admin Panel UI (Web or Modal)

**Pending Requests Table:**
- Filter bar: dropdown select player (or "All")
- Table columns: [checkbox] | Player | Total Kamas | Screenshot | Date | Status
- Rows: one per pending demand
- "View image" link: visible for all rows with images

**Pending Actions:**
- Checkboxes: select multiple demands to validate together
- "Validate selected" button: marks checked as paid, clears image_url, triggers notification
- "Clear all" button: only visible when single player filtered, rejects all their pending

**History Tab (Validated/Rejected):**
- Shows all past requests (validated, rejected, cleared)
- Still displays "View image" link to stored images
- Can filter by player, date range, status

## Implementation Checklist

- [ ] Add `prism_requests` table migration (PostgreSQL)
- [ ] Integrate existing recognition model for screenshot parsing
- [ ] Discord listener: attach to messages in `#prismes` channel
- [ ] Image upload logic: store as `/prismes-uploads/{request_id}.{ext}`
- [ ] Extract total_kamas from recognition model output
- [ ] DB update on validation: set image_url = NULL (keep file in storage)
- [ ] Image retrieval function: load image by request_id from storage
- [ ] Slash command `/admin-prismes view` → render pending table with checkboxes
- [ ] Validation workflow → update DB + clear image_url + notify player
- [ ] Player filter dropdown in admin panel
- [ ] "Clear all for player" batch reject action
- [ ] Channel mention notification: `@Player ✓ Demande(s) validée(s) par [Admin]`
- [ ] Admin history view: show validated/rejected with "View image" links
- [ ] Error handling: parsing failure, missing player data, image retrieval errors

## Example Screenshot Data

```
[08:54] x [Cuir d'Eskoglythe] (489 kamas)
[08:54] x [Cuir d'Eskoglythe] (490 kamas)
[08:54] x [Galet Lunaire] (19 498 kamas)
[08:54] x [Œil de Dawaj] (1 990 kamas)
[08:54] x [Pierre Angulaire] (2 418 kamas)

→ Recognition model extracts total: 24,965 kamas
→ Stored in prism_requests.total_kamas
```

## Related Code
- Recognition model integration: `src/services/image-recognition.js`
- Discord.js listeners: `src/discord/listeners.js`
- File storage/deletion: `src/services/file-storage.js`
- DB migrations: `migrations/`
- Existing OGRE components: screenshot handling, image storage

## Workflow Summary

| Step | Actor | Action | Result |
|------|-------|--------|--------|
| 1 | Player | Post screenshot in #prismes | Image + total stored, status = pending |
| 2 | Bot | Confirm receipt | ✓ reaction, ephemeral message |
| 3 | Admin | View pending requests | Sees table, can filter/select, view images |
| 4 | Admin | Validate selected or clear all | Status updated to validated/rejected |
| 5 | DB | Update on validation | image_url set to NULL, record kept for history |
| 6 | Storage | Images remain | `/prismes-uploads/{request_id}.{ext}` accessible anytime |
| 7 | Bot | Notify player | Channel mention with @Player |
| 8 | Admin | View history | Can see all past requests + view images by request_id |
