import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? "Admin";
const ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME ?? "admin";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@futurecourier.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin@12345";
const DRIVER_PASSWORD = process.env.SEED_DRIVER_PASSWORD ?? "Driver@12345";
const MANAGER_NAME = process.env.SEED_MANAGER_NAME ?? "Manager";
const MANAGER_USERNAME = process.env.SEED_MANAGER_USERNAME ?? "manager";
const MANAGER_PASSWORD = process.env.SEED_MANAGER_PASSWORD ?? "Manager@12345";

// Registered drivers. Every name that appears in the real order history below
// must exist here so orders can be attached to a real employee record.
const EMPLOYEES = ["ANAS", "NIYAS", "NOUSHAD", "FARIS", "MASOOD", "SAVAD"];

interface RawOrder {
  day: number;
  cn: number;
  brand: string;
  total: number;
  dl: number;
  payment: "CASH" | "BANK";
  emirate: string;
  employee: string;
  status: "DELIVERED" | "PENDING" | "CANCELLED" | "TRANSFER";
}

async function hash(pw: string) {
  return bcrypt.hash(pw, 10);
}

async function main() {
  console.log("Seeding company settings...");
  const existingSettings = await prisma.companySettings.findFirst();
  if (!existingSettings) {
    await prisma.companySettings.create({
      data: { name: "The Future Courier Service L.L.C" },
    });
  }

  console.log("Seeding vendors...");
  const ratesPath = path.join(__dirname, "seed-data", "vendor_rates.json");
  const rates: Record<string, number> = JSON.parse(fs.readFileSync(ratesPath, "utf-8"));
  const vendorIdByName = new Map<string, string>();
  for (const [name, deliveryCharge] of Object.entries(rates)) {
    const vendor = await prisma.vendor.upsert({
      where: { name },
      update: { deliveryCharge },
      create: { name, deliveryCharge },
    });
    vendorIdByName.set(name, vendor.id);
  }

  console.log("Seeding admin + manager + driver accounts...");
  await prisma.user.upsert({
    where: { username: ADMIN_USERNAME },
    update: {},
    create: {
      name: ADMIN_NAME,
      username: ADMIN_USERNAME,
      email: ADMIN_EMAIL,
      role: "SUPER_ADMIN",
      passwordHash: await hash(ADMIN_PASSWORD),
    },
  });

  await prisma.user.upsert({
    where: { username: MANAGER_USERNAME },
    update: {},
    create: {
      name: MANAGER_NAME,
      username: MANAGER_USERNAME,
      role: "MANAGER",
      passwordHash: await hash(MANAGER_PASSWORD),
    },
  });

  const employeeIdByName = new Map<string, string>();
  for (const name of EMPLOYEES) {
    const username = name.toLowerCase();
    const user = await prisma.user.upsert({
      where: { username },
      update: {},
      create: {
        name,
        username,
        role: "DRIVER",
        passwordHash: await hash(DRIVER_PASSWORD),
      },
    });
    employeeIdByName.set(name, user.id);
  }

  console.log("Loading real July 2026 consignment history...");
  const ordersPath = path.join(__dirname, "seed-data", "orders.json");
  const rawOrders: RawOrder[] = JSON.parse(fs.readFileSync(ordersPath, "utf-8"));

  const existingOrderCount = await prisma.order.count();
  if (existingOrderCount > 0) {
    console.log(`Orders table already has ${existingOrderCount} rows — skipping order seed (idempotent).`);
  } else {
    // Assign sequential SL numbers per calendar date, preserving each day's original row order.
    const slCounters = new Map<string, number>();
    const YEAR = 2026;
    const MONTH = 7; // July

    const batch: {
      date: Date;
      slNo: number;
      cnNo: number;
      vendorId: string;
      brandName: string;
      deliveryCharge: number;
      total: number;
      payment: "CASH" | "BANK";
      emirate: string;
      employeeId: string;
      status: "DELIVERED" | "PENDING" | "CANCELLED" | "TRANSFER";
    }[] = [];

    let skipped = 0;
    for (const raw of rawOrders) {
      const vendorId = vendorIdByName.get(raw.brand);
      const employeeId = employeeIdByName.get(raw.employee);
      if (!vendorId || !employeeId) {
        skipped++;
        continue;
      }
      const dateKey = `${YEAR}-${String(MONTH).padStart(2, "0")}-${String(raw.day).padStart(2, "0")}`;
      const slNo = (slCounters.get(dateKey) ?? 0) + 1;
      slCounters.set(dateKey, slNo);

      batch.push({
        date: new Date(Date.UTC(YEAR, MONTH - 1, raw.day)),
        slNo,
        cnNo: raw.cn,
        vendorId,
        brandName: raw.brand,
        deliveryCharge: raw.dl,
        total: raw.total,
        payment: raw.payment,
        emirate: raw.emirate,
        employeeId,
        status: raw.status,
      });
    }

    console.log(`Inserting ${batch.length} orders (skipped ${skipped} incomplete rows)...`);
    const CHUNK = 500;
    for (let i = 0; i < batch.length; i += CHUNK) {
      await prisma.order.createMany({ data: batch.slice(i, i + CHUNK) });
      console.log(`  ...${Math.min(i + CHUNK, batch.length)}/${batch.length}`);
    }
  }

  console.log("Seed complete.");
  console.log("---------------------------------------------");
  console.log(`Super Admin login  ->  username: ${ADMIN_USERNAME}   password: ${ADMIN_PASSWORD}`);
  console.log(`Manager login      ->  username: ${MANAGER_USERNAME}   password: ${MANAGER_PASSWORD}`);
  console.log(`Driver login       ->  username: <driver first name, lowercase>   password: ${DRIVER_PASSWORD}`);
  console.log(`e.g. username: anas   password: ${DRIVER_PASSWORD}`);
  console.log("---------------------------------------------");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
