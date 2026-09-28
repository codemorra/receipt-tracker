WITH seed_timestamp(value) AS (
  SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
), default_category(name) AS (
  VALUES
    ('food'),
    ('beverages'),
    ('drugstore'),
    ('household'),
    ('pet_supplies'),
    ('electronics'),
    ('clothing'),
    ('home_and_garden'),
    ('automotive'),
    ('leisure'),
    ('gastronomy'),
    ('services'),
    ('other')
)
INSERT INTO category (name, created_at, updated_at)
SELECT name, value, value
FROM default_category CROSS JOIN seed_timestamp;
