#!/usr/bin/env node
/**
 * Print the next iOS build number: one past the highest App Store Connect has
 * ever seen for this app, on any version train.
 *
 * EAS kept this counter on its own servers (`appVersionSource: remote`). A build
 * made anywhere else has to ask Apple instead, because Apple is the one that
 * rejects a repeated number -- after the upload, an hour into the run. Builds
 * still processing are listed too, so a number is never handed out twice.
 *
 * The EAS counter does not see these numbers. Before falling back to an EAS
 * build, bring it level: `eas build:version:set -p ios` with this script's
 * output.
 */
import { asc } from './asc-client.mjs';

const APP = process.env.ASC_APP_ID ?? '6808414695';
const { data } = await asc(`/v1/builds?filter[app]=${APP}&sort=-uploadedDate&limit=200&fields[builds]=version`);
const highest = Math.max(0, ...data.map((b) => Number.parseInt(b.attributes.version, 10)).filter(Number.isFinite));
console.log(highest + 1);
