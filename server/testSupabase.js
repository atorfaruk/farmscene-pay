
import supabase from "./supabase.js";

async function testDatabase() {
  const { data, error } = await supabase
    .from("suppliers")
    .select("id")
    .limit(1);

  if (error) {
    console.log("Database response:", error.message);
    return;
  }

  console.log("Supabase connection successful!");
  console.log("Supplier records:", data.length);
}

testDatabase();
