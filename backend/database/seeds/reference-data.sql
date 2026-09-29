-- Approved item categories; INSERT IGNORE preserves existing category rows.
INSERT IGNORE INTO categories (name) VALUES
  ('Phone'),
  ('ID Card'),
  ('Wallet'),
  ('Document'),
  ('Other');

-- Required, non-personal reference rows owned by this seed.
-- Fixed status IDs preserve the items.item_status_id default of 1.
INSERT IGNORE INTO item_statuses (id, status_name) VALUES
  (1, 'pending'),
  (2, 'verified'),
  (3, 'rejected'),
  (4, 'claimed'),
  (5, 'returned'),
  (6, 'deleted');

-- Locations are the existing application-provided Ethiopian city and region options.
-- INSERT IGNORE preserves existing rows and relies on the unique locations.name key.
INSERT IGNORE INTO locations (name) VALUES
  ('Addis Ababa'),
  ('Dire Dawa'),
  ('Adama (Nazret)'),
  ('Hawassa'),
  ('Bahir Dar'),
  ('Mekelle'),
  ('Jimma'),
  ('Dessie'),
  ('Gondar'),
  ('Harar'),
  ('Afar Region'),
  ('Amhara Region'),
  ('Oromia Region'),
  ('Somali Region'),
  ('Tigray Region'),
  ('Sidama Region'),
  ('Central Ethiopia Region'),
  ('South Ethiopia Region'),
  ('South West Ethiopia Region'),
  ('Benishangul-Gumuz Region'),
  ('Gambela Region'),
  ('Harari Region');
