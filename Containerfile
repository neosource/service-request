FROM docker.io/library/node:20-bookworm-slim AS node_runtime

FROM docker.io/library/mongo:7

WORKDIR /app

# Copy Node.js 20 runtime from the official image.
COPY --from=node_runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node_runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=node_runtime /usr/local/bin/npm /usr/local/bin/npm
COPY --from=node_runtime /usr/local/bin/npx /usr/local/bin/npx

RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
	&& ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# Install only production deps first for cache reuse.
COPY backend/package.json ./
RUN npm install --omit=dev

# Copy backend source.
COPY backend/src ./src
COPY backend/.env ./
# Copy frontend into the public dir so the API can serve the SPA.
COPY frontend ./public

# Start MongoDB, initialize app collections/indexes, then launch Node API.
RUN cat <<'EOF' > /usr/local/bin/start-service-request.sh
#!/bin/sh
set -eu

APP_DB="${APP_DB:-service_requests}"
MONGO_PORT="${MONGO_PORT:-27017}"
ROOT_USER="${ROOT_USER:-root}"
ROOT_PASS="${ROOT_PASS:-rootpass-change-me}"
APP_USER="${APP_USER:-srapp}"
APP_PASS="${APP_PASS:-srapp-pass}"

mkdir -p /data/db /var/log/mongodb

mongod \
	--dbpath /data/db \
	--bind_ip 127.0.0.1 \
	--port "$MONGO_PORT" \
	--logpath /var/log/mongodb/mongod.log \
	--logappend \
	>/dev/null 2>&1 &
MONGOD_PID=$!

cleanup() {
	if kill -0 "$MONGOD_PID" 2>/dev/null; then
		kill "$MONGOD_PID" 2>/dev/null || true
		wait "$MONGOD_PID" 2>/dev/null || true
	fi
}

trap cleanup INT TERM EXIT

until mongosh --quiet --port "$MONGO_PORT" --eval 'quit(0)' >/dev/null 2>&1; do
	if ! kill -0 "$MONGOD_PID" 2>/dev/null; then
		echo "mongod exited before becoming ready" >&2
		exit 1
	fi
	sleep 1
done

mongosh --quiet --port "$MONGO_PORT" admin --eval '
const admin = db.getSiblingDB("admin");
const rootUser = "'"$ROOT_USER"'";
const rootPass = "'"$ROOT_PASS"'";

if (!admin.getUser(rootUser)) {
	admin.createUser({
		user: rootUser,
		pwd: rootPass,
		roles: [{ role: "root", db: "admin" }]
	});
} else {
	admin.updateUser(rootUser, {
		pwd: rootPass,
		roles: [{ role: "root", db: "admin" }]
	});
}
'

mongosh --quiet --port "$MONGO_PORT" "$APP_DB" --eval '
db = db.getSiblingDB("'"$APP_DB"'");

const appUser = "'"$APP_USER"'";
const appPass = "'"$APP_PASS"'";

if (!db.getUser(appUser)) {
	db.createUser({
		user: appUser,
		pwd: appPass,
		roles: [{ role: "readWrite", db: "'"$APP_DB"'" }]
	});
} else {
	db.updateUser(appUser, {
		pwd: appPass,
		roles: [{ role: "readWrite", db: "'"$APP_DB"'" }]
	});
}

try { db.createCollection("serviceRequests"); } catch (e) {}
try { db.createCollection("counters"); } catch (e) {}
db.serviceRequests.createIndex({ caseNumber: 1 }, { unique: true, name: "uniq_caseNumber" });
db.serviceRequests.createIndex({ createdAt: -1 }, { name: "recent_first" });
db.serviceRequests.createIndex({ "customer.phone": 1 }, { name: "by_phone" });
'

kill "$MONGOD_PID"
wait "$MONGOD_PID"

mongod \
	--dbpath /data/db \
	--bind_ip 127.0.0.1 \
	--auth \
	--port "$MONGO_PORT" \
	--logpath /var/log/mongodb/mongod.log \
	--logappend \
	>/dev/null 2>&1 &
MONGOD_PID=$!

until mongosh --quiet --port "$MONGO_PORT" \
	-u "$ROOT_USER" \
	-p "$ROOT_PASS" \
	--authenticationDatabase admin \
	--eval 'db.adminCommand({ ping: 1 }).ok' >/dev/null 2>&1; do
	if ! kill -0 "$MONGOD_PID" 2>/dev/null; then
		echo "mongod exited before becoming ready (auth phase)" >&2
		exit 1
	fi
	sleep 1
done

export MONGO_URI="${MONGO_URI:-mongodb://${APP_USER}:${APP_PASS}@127.0.0.1:${MONGO_PORT}/${APP_DB}?authSource=${APP_DB}}"

exec node src/server.js
EOF

RUN chmod +x /usr/local/bin/start-service-request.sh

ENV PORT=3000

VOLUME ["/data/db"]

EXPOSE 3000 27017

# Reset upstream Mongo image entrypoint and run our combined process manager.
ENTRYPOINT []
CMD ["/usr/local/bin/start-service-request.sh"]
