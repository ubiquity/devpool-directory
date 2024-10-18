import { readFile } from "fs/promises";
import { commitTwitterMap } from "../git";

export type TwitterMap = Record<string, string>;

export async function initializeTwitterMap() {
  let twitterMap: TwitterMap = {};
  try {
    twitterMap = JSON.parse(await readFile("./twitter-map.json", "utf8"));
  } catch (error) {
    console.log("Couldn't find twitter map artifact, creating a new one");
    await commitTwitterMap(twitterMap);
  }
  return twitterMap;
}
