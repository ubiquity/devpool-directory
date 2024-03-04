import { http, HttpResponse } from "msw";
import { db } from "./db";

/**
 * Intercepts the routes and returns a custom payload
 */
export const handlers = [
  http.get("https://api.ubiquity.com/users", () => {
    return HttpResponse.json(db.users.getAll());
  }),
];
