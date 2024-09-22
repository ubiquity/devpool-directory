/**
 * Used for capturing the relevant task from the devpool body
 * 
 * returns an object with the following properties:
 * - owner
 * - repo
 * - number
 */
export const DEVPOOL_TASK_BODY_REGEX = /https:\/\/(www\.)?github.com\/(?<owner>[^/]+)\/(?<repo>[^/]+)\/issues\/(?<number>\d+)/;