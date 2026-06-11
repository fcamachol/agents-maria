# Coolify Migration Plan: Docker-Compose to Individual Resources

## Goal
Split the monolithic docker-compose Coolify app (UUID: `y4woc4kg44wkwos88cw0ws8g`) into 9 independent resources so each service can be deployed independently.

## Architecture: 9 Independent Coolify Resources

| Resource | Type | UUID | Hostname (for internal DNS) |
|---|---|---|---|
| **paco-postgres** | Database (PostgreSQL) | `b44804o4wkk0gwgcsc0kkwsw` | `b44804o4wkk0gwgcsc0kkwsw:5432` |
| **paco-redis** | Database (Redis) | `ko0wkcg04gskw8ocg0gc0ook` | `ko0wkcg04gskw8ocg0gc0ook:6379` |
| **paco-clickhouse** | Database (ClickHouse) | `pkso8s8kcgskok8cw04k44o0` | `pkso8s8kcgskok8cw04k44o0:8123` |
| **paco-langfuse** | Application (Docker Image) | `pskkc00sok44s04sw4oswgo0` | `pskkc00sok44s04sw4oswgo0:3000` |
| **paco-back** | Application (GitHub) | `fgo0k8o0wgwssgw0cwgcc84o` | `fgo0k8o0wgwssgw0cwgcc84o:8000` |
| **paco-front** | Application (GitHub) | `rkc88s08k8c8k4gwscskwcwo` | `rkc88s08k8c8k4gwscskwcwo:3000` |
| **paco-maria** | Application (GitHub) | `kowo40oo4kkkok00s0k4wwsw` | `kowo40oo4kkkok00s0k4wwsw:3002` |
| **paco-cea-tools** | Application (GitHub) | `c0ws40cs88scsksgcggscgog` | `c0ws40cs88scsksgcggscgog:3000` |
| **paco-agora-tools** | Application (GitHub) | `i88sckkggok4s8ggosgco0gs` | `i88sckkggok4s8ggosgco0gs:3000` |

## Key Findings from Testing

1. **Coolify overrides `container_name`** — uses `{service}-{uuid}` format, ignoring user-provided names
2. **Native databases** use the UUID directly as hostname (e.g., `b44804o4wkk0gwgcsc0kkwsw`)
3. **`coolify` network trick works** — declaring `networks: coolify: external: true` in docker_compose_raw is preserved by Coolify, allowing cross-resource communication
4. **Volume names** are prefixed with app UUID: `y4woc4kg44wkwos88cw0ws8g_postgres-data`

## Infrastructure Details

- **Server:** `v8owcscwo88ooc04wwc8ck84` (35.239.173.126)
- **Project:** `lwkwkc4koccgcc8o48wgk488` ("My first project")
- **Environment:** production
- **GitHub App:** `ewk448so0gc48sooko0wcw8s` (coolify-paco, repo: fcamachol/agents-maria)
- **Old monolithic app:** `y4woc4kg44wkwos88cw0ws8g`

## Progress

- [x] Task 1: Create 3 native Coolify databases
- [x] Task 2: Create 6 individual Coolify applications
- [x] Task 3: Set environment variables on all 6 applications
- [ ] **Task 4: Set base_directory on 5 GitHub apps (Coolify UI)**
- [ ] Task 5: Stop old monolithic app
- [ ] Task 6: Start databases and migrate postgres data
- [ ] Task 7: Deploy all 6 applications
- [ ] Task 8: Verify all services healthy
- [ ] Task 9: Clean up old resources

---

## Task 4: Set base_directory (MANUAL — Coolify UI)

The MCP API doesn't expose `base_directory`. Must be set in Coolify UI (http://35.239.173.126:8000).

Go to each app → Settings → General → Base Directory:

| App | UUID | Base Directory |
|---|---|---|
| paco-back | `fgo0k8o0wgwssgw0cwgcc84o` | `/paco/backend` |
| paco-front | `rkc88s08k8c8k4gwscskwcwo` | `/paco/frontend` |
| paco-maria | `kowo40oo4kkkok00s0k4wwsw` | `/paco/maria-claude` |
| paco-cea-tools | `c0ws40cs88scsksgcggscgog` | `/paco/mcp-servers/cea-tools` |
| paco-agora-tools | `i88sckkggok4s8ggosgco0gs` | `/paco/mcp-servers/agora-tools` |

---

## Task 5: Stop Old Monolithic App

```
mcp__coolify__control(resource=application, action=stop, uuid=y4woc4kg44wkwos88cw0ws8g)
```

**DO NOT DELETE** — keep volumes as rollback safety net.

Old volume names:
- `y4woc4kg44wkwos88cw0ws8g_postgres-data`
- `y4woc4kg44wkwos88cw0ws8g_redis-data`
- `y4woc4kg44wkwos88cw0ws8g_clickhouse-data`
- `y4woc4kg44wkwos88cw0ws8g_clickhouse-logs`

---

## Task 6: Start Databases & Migrate Data

### Start databases:
```
mcp__coolify__control(resource=database, action=start, uuid=b44804o4wkk0gwgcsc0kkwsw)  # postgres
mcp__coolify__control(resource=database, action=start, uuid=ko0wkcg04gskw8ocg0gc0ook)  # redis
mcp__coolify__control(resource=database, action=start, uuid=pkso8s8kcgskok8cw04k44o0)  # clickhouse
```

### Migrate postgres data (SSH to 35.239.173.126):
```bash
# 1. Dump from old (stopped) container's volume
docker run --rm -v y4woc4kg44wkwos88cw0ws8g_postgres-data:/data:ro postgres:16-alpine \
  pg_dumpall -U paco -h /data > /tmp/paco_dump.sql

# OR if old container is still accessible:
docker exec postgres-y4woc4kg44wkwos88cw0ws8g-014330198411 pg_dumpall -U paco > /tmp/paco_dump.sql

# 2. Create langfuse database in new postgres:
docker exec -i b44804o4wkk0gwgcsc0kkwsw psql -U paco -c "CREATE DATABASE langfuse;"
docker exec -i b44804o4wkk0gwgcsc0kkwsw psql -U paco -c "GRANT ALL PRIVILEGES ON DATABASE langfuse TO paco;"

# 3. Restore dump:
docker exec -i b44804o4wkk0gwgcsc0kkwsw psql -U paco < /tmp/paco_dump.sql
```

### Redis password issue:
New Redis has auto-generated password: `t02yHp4aO4iY5NEIuNX7InoyxxsVx2lICbSdf1R7nneeEjV4GjvGAy2pybPX5fSF`
Current app env vars use `redis://ko0wkcg04gskw8ocg0gc0ook:6379` (no auth).
**Fix:** Either disable Redis auth in Coolify DB settings, OR update all app env vars to include password.

### ClickHouse keeper config:
Old setup used custom Dockerfile with keeper.xml config. New native ClickHouse may lack this.
If Langfuse fails with replicated table errors, inject keeper config:
```bash
docker exec -i pkso8s8kcgskok8cw04k44o0 bash -c 'cat > /etc/clickhouse-server/config.d/keeper.xml << EOF
<clickhouse>
    <listen_host>0.0.0.0</listen_host>
    <keeper_server>
        <tcp_port>9181</tcp_port>
        <server_id>1</server_id>
        <log_storage_path>/var/lib/clickhouse/coordination/log</log_storage_path>
        <snapshot_storage_path>/var/lib/clickhouse/coordination/snapshots</snapshot_storage_path>
        <coordination_settings>
            <operation_timeout_ms>10000</operation_timeout_ms>
            <session_timeout_ms>30000</session_timeout_ms>
        </coordination_settings>
        <raft_configuration>
            <server><id>1</id><hostname>localhost</hostname><port>9234</port></server>
        </raft_configuration>
    </keeper_server>
    <zookeeper>
        <node><host>localhost</host><port>9181</port></node>
    </zookeeper>
    <macros><shard>1</shard><replica>1</replica><cluster>default</cluster></macros>
</clickhouse>
EOF'
# Then restart clickhouse
```

---

## Task 7: Deploy All Applications

Deploy in dependency order:
```
mcp__coolify__deploy(tag_or_uuid=pskkc00sok44s04sw4oswgo0)  # langfuse (needs DBs)
mcp__coolify__deploy(tag_or_uuid=fgo0k8o0wgwssgw0cwgcc84o)  # backend (needs DBs + langfuse)
mcp__coolify__deploy(tag_or_uuid=rkc88s08k8c8k4gwscskwcwo)  # frontend (needs backend)
mcp__coolify__deploy(tag_or_uuid=kowo40oo4kkkok00s0k4wwsw)  # maria (needs DBs)
mcp__coolify__deploy(tag_or_uuid=c0ws40cs88scsksgcggscgog)  # cea-tools (standalone)
mcp__coolify__deploy(tag_or_uuid=i88sckkggok4s8ggosgco0gs)  # agora-tools (needs postgres)
```

**PREREQUISITE:** base_directory must be set (Task 4) before deploying!

---

## Task 8: Verify

- Check all DB status via `mcp__coolify__get_database`
- Check all app status via `mcp__coolify__get_application`
- Check logs via `mcp__coolify__application_logs`
- Test frontend: http://rkc88s08k8c8k4gwscskwcwo.35.239.173.126.sslip.io
- Test langfuse: http://pskkc00sok44s04sw4oswgo0.35.239.173.126.sslip.io

---

## Task 9: Clean Up

```
mcp__coolify__service(action=delete, uuid=q8kw8okg84wg4g488w4ogsck)  # test service
mcp__coolify__application(action=delete, uuid=y4woc4kg44wkwos88cw0ws8g, delete_volumes=false)  # old app (KEEP VOLUMES)
```

---

## Rollback Plan

If migration fails:
1. Stop all new resources
2. Re-start old app: `mcp__coolify__control(resource=application, action=start, uuid=y4woc4kg44wkwos88cw0ws8g)`
3. Old app picks up its original volumes — no data loss
4. Delete failed new resources
