import csv
import os

SRC = "/home/claude/leela/Leela_Palace - BigQuery V2 (7-14)"
OUT = "/home/claude/leela_palace_mysql.sql"

# Column type overrides (numeric / date / bool / time). Default = VARCHAR/TEXT.
schema = {
    "departments": {
        "cols": ["department_id", "department_name", "location", "head_id"],
        "types": {"department_id": "INT", "department_name": "VARCHAR(100)", "location": "VARCHAR(100)", "head_id": "VARCHAR(10)"},
        "pk": "department_id",
    },
    "salary_grades": {
        "cols": ["grade_id", "grade_name", "role_level", "min_salary_inr", "max_salary_inr"],
        "types": {"grade_id": "VARCHAR(10)", "grade_name": "VARCHAR(50)", "role_level": "VARCHAR(50)", "min_salary_inr": "INT", "max_salary_inr": "INT"},
        "pk": "grade_id",
    },
    "staff": {
        "cols": ["staff_id", "first_name", "last_name", "role", "department_id", "grade_id", "manager_id", "employment_type", "status", "hire_date", "email"],
        "types": {"staff_id": "VARCHAR(10)", "first_name": "VARCHAR(50)", "last_name": "VARCHAR(50)", "role": "VARCHAR(100)", "department_id": "INT", "grade_id": "VARCHAR(10)", "manager_id": "VARCHAR(10)", "employment_type": "VARCHAR(20)", "status": "VARCHAR(20)", "hire_date": "DATE", "email": "VARCHAR(100)"},
        "pk": "staff_id",
    },
    "staff_salaries": {
        "cols": ["salary_id", "staff_id", "monthly_salary_inr", "effective_date", "salary_type"],
        "types": {"salary_id": "INT", "staff_id": "VARCHAR(10)", "monthly_salary_inr": "INT", "effective_date": "DATE", "salary_type": "VARCHAR(20)"},
        "pk": "salary_id",
    },
    "rooms": {
        "cols": ["room_id", "room_number", "room_type", "room_category", "floor_number", "base_price_inr", "min_price_inr", "max_price_inr", "max_occupancy", "has_plunge_pool", "has_balcony", "status"],
        "types": {"room_id": "INT", "room_number": "VARCHAR(10)", "room_type": "VARCHAR(100)", "room_category": "VARCHAR(50)", "floor_number": "INT", "base_price_inr": "INT", "min_price_inr": "INT", "max_price_inr": "INT", "max_occupancy": "INT", "has_plunge_pool": "TINYINT(1)", "has_balcony": "TINYINT(1)", "status": "VARCHAR(30)"},
        "pk": "room_id",
    },
    "guests": {
        "cols": ["guest_id", "first_name", "last_name", "email", "phone", "nationality", "loyalty_tier", "total_stays", "date_of_birth", "status", "guest_since"],
        "types": {"guest_id": "VARCHAR(10)", "first_name": "VARCHAR(50)", "last_name": "VARCHAR(50)", "email": "VARCHAR(100)", "phone": "VARCHAR(20)", "nationality": "VARCHAR(50)", "loyalty_tier": "VARCHAR(20)", "total_stays": "INT", "date_of_birth": "DATE", "status": "VARCHAR(20)", "guest_since": "DATE"},
        "pk": "guest_id",
    },
    "reservations": {
        "cols": ["reservation_id", "guest_id", "room_id", "check_in_date", "check_out_date", "num_guests", "booking_source", "booking_status", "special_request", "total_amount_inr"],
        "types": {"reservation_id": "VARCHAR(10)", "guest_id": "VARCHAR(10)", "room_id": "INT", "check_in_date": "DATE", "check_out_date": "DATE", "num_guests": "INT", "booking_source": "VARCHAR(30)", "booking_status": "VARCHAR(30)", "special_request": "VARCHAR(255)", "total_amount_inr": "INT"},
        "pk": "reservation_id",
    },
    "restaurants": {
        "cols": ["restaurant_id", "name", "cuisine_type", "meal_period", "seating_capacity", "avg_cover_price_inr", "is_open", "head_chef_first", "head_chef_last"],
        "types": {"restaurant_id": "INT", "name": "VARCHAR(100)", "cuisine_type": "VARCHAR(100)", "meal_period": "VARCHAR(30)", "seating_capacity": "INT", "avg_cover_price_inr": "INT", "is_open": "TINYINT(1)", "head_chef_first": "VARCHAR(50)", "head_chef_last": "VARCHAR(50)"},
        "pk": "restaurant_id",
    },
    "dining_orders": {
        "cols": ["order_id", "reservation_id", "restaurant_id", "order_date", "num_covers", "food_amount_inr", "beverage_amount_inr", "service_charge_inr", "payment_method", "feedback_score"],
        "types": {"order_id": "VARCHAR(10)", "reservation_id": "VARCHAR(10)", "restaurant_id": "INT", "order_date": "DATE", "num_covers": "INT", "food_amount_inr": "INT", "beverage_amount_inr": "INT", "service_charge_inr": "INT", "payment_method": "VARCHAR(30)", "feedback_score": "INT"},
        "pk": "order_id",
    },
    "spa_services": {
        "cols": ["service_id", "service_name", "category", "duration_mins", "price_inr", "is_couple_option"],
        "types": {"service_id": "VARCHAR(10)", "service_name": "VARCHAR(100)", "category": "VARCHAR(50)", "duration_mins": "INT", "price_inr": "INT", "is_couple_option": "TINYINT(1)"},
        "pk": "service_id",
    },
    "spa_bookings": {
        "cols": ["spa_booking_id", "reservation_id", "service_id", "booking_date", "appointment_time", "therapist_staff_id", "num_persons", "amount_paid_inr", "is_complimentary", "rating"],
        "types": {"spa_booking_id": "VARCHAR(10)", "reservation_id": "VARCHAR(10)", "service_id": "VARCHAR(10)", "booking_date": "DATE", "appointment_time": "TIME", "therapist_staff_id": "VARCHAR(10)", "num_persons": "INT", "amount_paid_inr": "INT", "is_complimentary": "TINYINT(1)", "rating": "INT"},
        "pk": "spa_booking_id",
    },
}

# Load order (respect FKs)
order = [
    "departments", "salary_grades", "staff", "staff_salaries", "rooms",
    "guests", "reservations", "restaurants", "dining_orders",
    "spa_services", "spa_bookings",
]

# Foreign keys
fks = {
    "staff": [
        ("department_id", "departments", "department_id"),
        ("grade_id", "salary_grades", "grade_id"),
        ("manager_id", "staff", "staff_id"),
    ],
    "staff_salaries": [("staff_id", "staff", "staff_id")],
    "reservations": [
        ("guest_id", "guests", "guest_id"),
        ("room_id", "rooms", "room_id"),
    ],
    "dining_orders": [
        ("reservation_id", "reservations", "reservation_id"),
        ("restaurant_id", "restaurants", "restaurant_id"),
    ],
    "spa_bookings": [
        ("reservation_id", "reservations", "reservation_id"),
        ("service_id", "spa_services", "service_id"),
        ("therapist_staff_id", "staff", "staff_id"),
    ],
}


def sql_val(v, t):
    """Convert a CSV field into a safely quoted MySQL literal."""
    if v is None or v == "":
        return "NULL"

    if t.startswith("INT") or t.startswith("TINYINT"):
        if t.startswith("TINYINT"):
            return "1" if str(v).strip().upper() in ("TRUE", "1", "YES") else "0"
        return str(int(float(v)))

    if t == "DATE" or t == "TIME":
        return "'" + v.replace("'", "''") + "'"

    return "'" + v.replace("'", "''") + "'"


def main():
    lines = [
        "-- Leela Palace — MySQL schema + data",
        "-- Converted from BigQuery CSV export\n",
        "SET FOREIGN_KEY_CHECKS=0;\n",
    ]

    # Drop tables in reverse dependency order.
    for table in reversed(order):
        lines.append(f"DROP TABLE IF EXISTS `{table}`;")
    lines.append("")

    # Create tables.
    for table in order:
        table_schema = schema[table]
        col_defs = []

        for col in table_schema["cols"]:
            col_type = table_schema["types"][col]
            nullability = " NOT NULL" if col == table_schema["pk"] else " NULL"
            col_defs.append(f"  `{col}` {col_type}{nullability}")

        col_defs.append(f"  PRIMARY KEY (`{table_schema['pk']}`)")

        for col, ref_table, ref_col in fks.get(table, []):
            col_defs.append(
                f"  CONSTRAINT `fk_{table}_{col}` "
                f"FOREIGN KEY (`{col}`) REFERENCES `{ref_table}`(`{ref_col}`)"
            )

        lines.append(
            f"CREATE TABLE `{table}` (\n"
            + ",\n".join(col_defs)
            + "\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n"
        )

    # Insert CSV data.
    for table in order:
        table_schema = schema[table]
        path = os.path.join(SRC, f"{table}.csv")

        with open(path, newline="", encoding="utf-8") as csv_file:
            reader = csv.DictReader(csv_file)
            rows = list(reader)

        if not rows:
            continue

        columns_sql = ", ".join(f"`{col}`" for col in table_schema["cols"])
        lines.append(f"-- {table}: {len(rows)} rows")
        lines.append(f"INSERT INTO `{table}` ({columns_sql}) VALUES")

        value_rows = []
        for row in rows:
            values = [
                sql_val(row.get(col, ""), table_schema["types"][col])
                for col in table_schema["cols"]
            ]
            value_rows.append("  (" + ", ".join(values) + ")")

        lines.append(",\n".join(value_rows) + ";\n")

    lines.append("SET FOREIGN_KEY_CHECKS=1;")

    with open(OUT, "w", encoding="utf-8") as sql_file:
        sql_file.write("\n".join(lines))

    print("Wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
