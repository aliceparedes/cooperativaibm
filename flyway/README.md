# Flyway Database Migration

This directory contains Flyway database migration scripts for the Cooperativa IBM project.

## Running Migrations

To run database migrations using Docker, use the following command:

```bash
docker run --rm -it -v "$PWD"/sql:/flyway/sql -v "$PWD"/conf:/flyway/conf -v "$PWD"/drivers:/flyway/drivers flyway/flyway:11 migrate
```

### Directory Structure

- `sql/` - Contains your SQL migration scripts
- `conf/` - Contains Flyway configuration files
- `drivers/` - Contains any custom JDBC drivers needed
