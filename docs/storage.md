# Storage Setup

xyOps is built atop the [pixl-server-storage](https://github.com/jhuckaby/pixl-server-storage) module, and uses it both as a database and for general file storage.  It supports multiple back-end "engines" for handling the underlying data I/O, including a special [Hybrid](https://github.com/jhuckaby/pixl-server-storage#hybrid) engine for splitting data and files across two different providers.

This is important because xyOps has **two very different storage workloads**:

- **Data**: Lots of small JSON records, used in lists, hashes, indexes, job data, monitoring data, and general app metadata.
- **Files**: Bucket files, ticket attachments, user uploads, avatars, job files, compressed job logs, and other binary payloads.

Some engines can serve both roles really well, namely [MinIO](#minio) and [RustFS](#rustfs), because they provide very fast S3-compatible object storage on premises.  However, most of the other engines only handle one side of the workload well, so you should generally use a [Hybrid](https://github.com/jhuckaby/pixl-server-storage#hybrid) configuration for them.

In general:

| Engine / Provider | Good for Data | Good for Files | Notes |
|-------------------|---------------|----------------|-------|
| Filesystem | - | ✅ | Fine for local files, but not shared across conductors. |
| NFS | - | ✅ | Only recommended for binary files, not tiny JSON record workloads. |
| AWS S3 | - | ✅ | Fine for files, but too latent for xyOps database traffic. |
| MinIO (S3) | ✅ | ✅ | Excellent on premises when kept close to the conductors. |
| RustFS (S3) | ✅ | ✅ | Same category as MinIO, fast enough for both roles on premises. |
| Redis | ✅ | - | Great for tiny records, poor fit for general binary files. |
| SQLite | ✅ | - | Great local doc store, but single-host only. |
| Postgres | ✅ | - | Good shared doc store, but not ideal for large files. |

For single-conductor deployments, meaning development, testing, homelabs, and small internal tools, the default configuration of [SQLite and Filesystem](#sqlite-and-filesystem) should work just fine.  However, for live production and especially for multi-conductor deployments, you should either:

1. Use a single fast S3-compatible engine such as [MinIO](#minio) or [RustFS](#rustfs), or
2. Use a [Hybrid](https://github.com/jhuckaby/pixl-server-storage#hybrid) configuration with a document-oriented engine for JSON data, and a file-oriented engine for binaries.

## Rules of Thumb

- For a **single conductor**, use the stock [SQLite and Filesystem](#sqlite-and-filesystem) setup unless you have a clear reason to change it.
- For **multi-conductor** and/or live production, you need shared external storage for all conductors.  Local SQLite plus local disk is not enough.
- If you already run an on-prem S3 service, prefer **MinIO** or **RustFS** and keep the configuration simple by using the `S3` engine directly.
- If you already operate **Redis** or **Postgres** and want to keep using them, pair them with **S3** or **NFS** via the [Hybrid](https://github.com/jhuckaby/pixl-server-storage#hybrid) engine.
- Leave [Storage.transactions](config.md#storage-transactions) enabled no matter which engine(s) you choose.
- Keep your conductors as close as possible to the storage engine handling data.  Latency matters a lot for xyOps.

## Recommended Configurations

### SQLite and Filesystem

> [!TIP]
> This is the default storage configuration that ships with xyOps.  It should work fine for any single-conductor setup.

This configuration utilizes the [Hybrid](https://github.com/jhuckaby/pixl-server-storage#hybrid) engine to use [SQLite](https://github.com/jhuckaby/pixl-server-storage#sqlite) for the database, and [Filesystem](https://github.com/jhuckaby/pixl-server-storage#local-filesystem) for general file storage.  Example setup:

```json
{
	"engine": "Hybrid",

	"Hybrid": {
		"docEngine": "SQLite",
		"binaryEngine": "Filesystem"
	},

	"Filesystem": {
		"base_dir": "data",
		"key_namespaces": 1
	},

	"SQLite": {
		"base_dir": "data",
		"filename": "sqlite.db",
		"pragmas": {
			"auto_vacuum": 0,
			"cache_size": -100000,
			"journal_mode": "WAL"
		},
		"cache": {
			"enabled": true,
			"maxItems": 100000,
			"maxBytes": 104857600
		},
		"backups": {
			"enabled": true,
			"dir": "data/backups",
			"filename": "backup-[yyyy]-[mm]-[dd]-[hh]-[mi]-[ss].db",
			"compress": true,
			"keep": 7
		}
	}
}
```

Use this when:

- You only have one conductor.
- You want the simplest possible setup.
- Your database and file storage can both live on the same local disk.

The downside to this configuration is that it only supports a single conductor.  The database is local to that host, so there is nothing for another conductor to share.

See also:

- [Hybrid Engine](https://github.com/jhuckaby/pixl-server-storage#hybrid)
- [SQLite Engine](https://github.com/jhuckaby/pixl-server-storage#sqlite)
- [Filesystem Engine](https://github.com/jhuckaby/pixl-server-storage#local-filesystem)

### SQLite and NFS

This is very similar to [SQLite and Filesystem](#sqlite-and-filesystem), except that the Filesystem engine's `base_dir` points to an NFS mount.  Conversely, the SQLite engine's `base_dir` should point to a local directory which is *not* NFS mounted.  Finally, the SQLite backups can point to the NFS mount if you would like to keep a copy off the conductor host.

Assumptions:

- `/mnt/xyops` is your NFS mount.
- `/data/xyops` is a local directory with enough disk space for SQLite.

Example setup:

```json
{
	"engine": "Hybrid",

	"Hybrid": {
		"docEngine": "SQLite",
		"binaryEngine": "Filesystem"
	},

	"Filesystem": {
		"base_dir": "/mnt/xyops",
		"key_namespaces": 1
	},

	"SQLite": {
		"base_dir": "/data/xyops",
		"filename": "sqlite.db",
		"pragmas": {
			"auto_vacuum": 0,
			"cache_size": -100000,
			"journal_mode": "WAL"
		},
		"cache": {
			"enabled": true,
			"maxItems": 100000,
			"maxBytes": 104857600
		},
		"backups": {
			"enabled": true,
			"dir": "/mnt/xyops/db-backups",
			"filename": "backup-[yyyy]-[mm]-[dd]-[hh]-[mi]-[ss].db",
			"compress": true,
			"keep": 7
		}
	}
}
```

Use this when:

- You only have one conductor.
- You want files on a NAS or shared volume.
- You still want SQLite to stay on fast local disk.

The downside to this configuration is that it still only supports a single conductor, because the SQLite database is local to one machine.  Also, if you lose the conductor due to local disk failure, you will need to restore from a SQLite backup.  Those backups are written daily, so some data loss is possible between the last backup and the failure.

See also:

- [Hybrid Engine](https://github.com/jhuckaby/pixl-server-storage#hybrid)
- [SQLite Engine](https://github.com/jhuckaby/pixl-server-storage#sqlite)
- [Filesystem Engine](https://github.com/jhuckaby/pixl-server-storage#local-filesystem)

### MinIO

> [!WARNING]
> Before adopting MinIO, review its current licensing, packaging, and support status.  MinIO remains an excellent technical fit for xyOps, but the [project landscape has changed](https://www.chainguard.dev/unchained/secure-and-free-minio-chainguard-containers) recently.

MinIO is a great choice for xyOps because, as an S3-compatible provider, it handles both data and files with ease.  That means it does **not** need to be part of a hybrid storage configuration.  You can simply use the `S3` engine directly.  Also, unlike AWS S3 which has higher latency, MinIO is very fast when hosted on premises, which is the assumption here.

Here is a quick-start guide to getting MinIO up and running.  First, create a Docker volume to store your MinIO data:

```sh
docker volume create minio-data
```

Next, download and run the [Chainguard MinIO](https://images.chainguard.dev/directory/image/minio/overview) container, binding to the new data volume:

```sh
docker run --detach --name minio -p 9000:9000 -p 9001:9001 -v minio-data:/data cgr.dev/chainguard/minio:latest server /data --console-address ":9001"
```

If you are also running xyOps in Docker on the same machine, you will need to [create a Docker network](https://docs.docker.com/engine/network/) and add both containers to the same network so they can communicate with each other.

Pull up the MinIO web interface in your browser by navigating to `http://MINIO_HOSTNAME:9001`.  Log in using the default MinIO admin username and password for a fresh install, then change them immediately:

- **Username**: `minioadmin`
- **Password**: `minioadmin`

Create a new bucket, for example `xydata`.

Then shut down xyOps completely, and reconfigure your [Storage.AWS](config.md#storage-aws) and [Storage.S3](config.md#storage-s3) objects thusly:

```json
"AWS": {
	"endpoint": "http://MINIO_HOSTNAME:9000",
	"endpointPrefix": false,
	"forcePathStyle": true,
	"hostPrefixEnabled": false,
	"region": "us-west-1",
	"credentials": {
		"accessKeyId": "YOUR_MINIO_USERNAME",
		"secretAccessKey": "YOUR_MINIO_PASSWORD"
	}
},
"S3": {
	"connectTimeout": 5000,
	"socketTimeout": 5000,
	"maxAttempts": 50,
	"keyPrefix": "xyops/",
	"fileExtensions": true,
	"params": {
		"Bucket": "YOUR_MINIO_BUCKET_ID"
	},
	"cache": {
		"enabled": true,
		"maxItems": 100000,
		"maxBytes": 104857600
	}
}
```

For initial testing you can set `accessKeyId` and `secretAccessKey` to the MinIO defaults, but you should replace them before production.

Finally, set [Storage.engine](config.md#storage-engine) to `S3` and restart xyOps.

Why this is recommended:

- The MinIO engine handles both JSON records and files.
- All conductors can share the same backend.
- Latency is low enough for the tiny-record database workload.
- Operationally, it is simpler than running separate data and file stores.

See [Migration](#migration) below for migrating data between storage engines.

### RustFS

[RustFS](https://rustfs.com/) is also a great choice for xyOps because, as an S3-compatible provider, it handles both data and files with ease.  That means it does **not** need to be part of a hybrid storage configuration.  Like MinIO, it can be used directly via the `S3` engine.  Also unlike AWS S3, RustFS is very fast when hosted on premises, which is the assumption here.

Here is a quick-start guide to getting RustFS up and running.  Note that as of this writing, RustFS is still relatively young, so test it carefully in your own environment before rolling it into a mission-critical production system.

First, create a Docker volume to store your RustFS data:

```sh
docker volume create rustfs-data
```

Next, download and run the official RustFS container, binding to the new data volume:

```sh
docker run -d --name rustfs -p 9000:9000 -p 9001:9001 -v rustfs-data:/data rustfs/rustfs:latest
```

If you are also running xyOps in Docker on the same machine, you will need to [create a Docker network](https://docs.docker.com/engine/network/) and add both containers to the same network so they can communicate with each other.

Pull up the RustFS web interface in your browser by navigating to `http://RUSTFS_HOSTNAME:9001`.  Log in using the default RustFS admin username and password, then change them immediately:

- **Username**: `rustfsadmin`
- **Password**: `rustfsadmin`

Create a new bucket, for example `xydata`.

Create a new access key, and save both the key and secret.

Then shut down xyOps completely, and reconfigure your [Storage.AWS](config.md#storage-aws) and [Storage.S3](config.md#storage-s3) objects thusly:

```json
"AWS": {
	"endpoint": "http://RUSTFS_HOSTNAME:9000",
	"endpointPrefix": false,
	"forcePathStyle": true,
	"hostPrefixEnabled": false,
	"region": "us-west-1",
	"credentials": {
		"accessKeyId": "YOUR_RUSTFS_ACCESS_KEY",
		"secretAccessKey": "YOUR_RUSTFS_SECRET_KEY"
	}
},
"S3": {
	"connectTimeout": 5000,
	"socketTimeout": 5000,
	"maxAttempts": 50,
	"keyPrefix": "xyops/",
	"fileExtensions": true,
	"params": {
		"Bucket": "YOUR_RUSTFS_BUCKET_ID"
	},
	"cache": {
		"enabled": true,
		"maxItems": 100000,
		"maxBytes": 104857600
	}
}
```

Finally, set [Storage.engine](config.md#storage-engine) to `S3` and restart xyOps.

Why this is recommended:

- RustFS engine handles both JSON records and files.
- All conductors can share the same backend.
- On-prem latency is low enough for xyOps database traffic.
- It avoids the complexity of operating two separate storage tiers.

See [Migration](#migration) below for migrating data between storage engines.

### Redis and NFS

This configuration uses [Redis](https://github.com/jhuckaby/pixl-server-storage#redis) for JSON records and [Filesystem](https://github.com/jhuckaby/pixl-server-storage#local-filesystem) pointed at an NFS mount for binary files.  This is a solid production option if you already operate Redis reliably and already have a NAS or NFS service for shared files.

Assumptions:

- `redis.internal.mycompany.com` is your Redis host.
- `/mnt/xyops` is an NFS mount visible to all conductors.
- Redis persistence is enabled, meaning RDB and/or AOF.

Example setup:

```json
{
	"engine": "Hybrid",

	"Hybrid": {
		"docEngine": "Redis",
		"binaryEngine": "Filesystem"
	},

	"Redis": {
		"host": "redis.internal.mycompany.com",
		"port": 6379,
		"keyPrefix": "xyops/",
		"keyTemplate": ""
	},

	"Filesystem": {
		"base_dir": "/mnt/xyops",
		"key_namespaces": 1
	}
}
```

If you have a cluster of multiple Redis servers, use the [RedisCluster](https://github.com/jhuckaby/pixl-server-storage#rediscluster) engine instead:

```json
"RedisCluster": {
	"host": "redis.internal.mycompany.com",
	"port": 6379,
	"connectRetries": 5,
	"clusterOpts": {
		"scaleReads": "master",
		"redisOptions": {
			"commandTimeout": 5000,
			"connectTimeout": 5000
		}
	},
	"keyPrefix": "xyops/",
	"keyTemplate": ""
}
```

Use this when:

- You already trust Redis for low-latency key/value data.
- You already have shared NFS storage for files.
- You want multi-conductor support without introducing an on-prem S3 service.

Tradeoffs:

- You now operate two different storage systems instead of one.
- NFS is only recommended for binary files, not the document workload.
- Redis must be configured for persistence, or a restart can become a data-loss event.
- Large file traffic still depends on NFS performance and mount stability.

If you are starting from scratch on premises, [MinIO](#minio) or [RustFS](#rustfs) are usually simpler and cleaner.

### Redis and S3

This configuration uses Redis for JSON records and S3 for binary files.  It is a good production option if you already operate Redis and already have object storage, especially managed AWS S3 or a S3-compatible remote service.

Example setup:

```json
{
	"engine": "Hybrid",

	"Hybrid": {
		"docEngine": "Redis",
		"binaryEngine": "S3"
	},

	"Redis": {
		"host": "redis.internal.mycompany.com",
		"port": 6379,
		"keyPrefix": "xyops/",
		"keyTemplate": ""
	},

	"AWS": {
		"region": "us-west-1",
		"credentials": {
			"accessKeyId": "YOUR_AMAZON_ACCESS_KEY",
			"secretAccessKey": "YOUR_AMAZON_SECRET_KEY"
		}
	},

	"S3": {
		"connectTimeout": 5000,
		"socketTimeout": 5000,
		"maxAttempts": 50,
		"keyPrefix": "xyops/",
		"fileExtensions": true,
		"params": {
			"Bucket": "YOUR_S3_BUCKET_ID"
		},
		"cache": {
			"enabled": true,
			"maxItems": 100000,
			"maxBytes": 104857600
		}
	}
}
```

If you have a cluster of multiple Redis servers, use the [RedisCluster](https://github.com/jhuckaby/pixl-server-storage#rediscluster) engine instead:

```json
"RedisCluster": {
	"host": "redis.internal.mycompany.com",
	"port": 6379,
	"connectRetries": 5,
	"clusterOpts": {
		"scaleReads": "master",
		"redisOptions": {
			"commandTimeout": 5000,
			"connectTimeout": 5000
		}
	},
	"keyPrefix": "xyops/",
	"keyTemplate": ""
}
```

Use this when:

- You already run Redis and want it to remain your document store.
- You want files in object storage rather than on NFS.
- You need multi-conductor support.

Tradeoffs:

- You still operate two different storage systems.
- AWS S3 is fine for files, but not for the JSON record workload, which is why it stays on Redis.
- If you are on premises and the S3 endpoint is actually MinIO or RustFS, it is usually simpler to skip Redis and use `S3` alone.

### Postgres and NFS

This configuration uses [Postgres](https://github.com/jhuckaby/pixl-server-storage#postgres) for JSON records and [Filesystem](https://github.com/jhuckaby/pixl-server-storage#local-filesystem) pointed at NFS for binary files.  It is a good fit if your organization already runs a highly available Postgres service and you want to keep xyOps inside that operational model.

Assumptions:

- `postgres.internal.mycompany.com` is your Postgres host.
- `/mnt/xyops` is an NFS mount visible to all conductors.

Example setup:

```json
{
	"engine": "Hybrid",

	"Hybrid": {
		"docEngine": "Postgres",
		"binaryEngine": "Filesystem"
	},

	"Postgres": {
		"min": 1,
		"max": 32,
		"host": "postgres.internal.mycompany.com",
		"database": "YOUR_DB_INSTANCE",
		"user": "YOUR_DB_USERNAME",
		"password": "YOUR_DB_PASSWORD",
		"port": 5432,
		"statement_timeout": 5000,
		"query_timeout": 6000,
		"connectionTimeoutMillis": 30000,
		"idleTimeoutMillis": 10000,
		"table": "xyops",
		"cache": {
			"enabled": true,
			"maxItems": 100000,
			"maxBytes": 104857600
		}
	},

	"Filesystem": {
		"base_dir": "/mnt/xyops",
		"key_namespaces": 1
	}
}
```

Use this when:

- Your team already operates Postgres at scale.
- You want multi-conductor support.
- You want files on shared storage rather than in the database.

Tradeoffs:

- You still operate two storage systems.
- Postgres is a very good document store here, but only because files stay out of it.

### Postgres and S3

This configuration uses Postgres for JSON records and S3 for binary files.  This is the best hybrid choice for teams that already trust Postgres for app state and already have object storage for files.

Example setup:

```json
{
	"engine": "Hybrid",

	"Hybrid": {
		"docEngine": "Postgres",
		"binaryEngine": "S3"
	},

	"Postgres": {
		"min": 1,
		"max": 32,
		"host": "postgres.internal.mycompany.com",
		"database": "YOUR_DB_INSTANCE",
		"user": "YOUR_DB_USERNAME",
		"password": "YOUR_DB_PASSWORD",
		"port": 5432,
		"statement_timeout": 5000,
		"query_timeout": 6000,
		"connectionTimeoutMillis": 30000,
		"idleTimeoutMillis": 10000,
		"table": "xyops",
		"cache": {
			"enabled": true,
			"maxItems": 100000,
			"maxBytes": 104857600
		}
	},

	"AWS": {
		"region": "us-west-1",
		"credentials": {
			"accessKeyId": "YOUR_AMAZON_ACCESS_KEY",
			"secretAccessKey": "YOUR_AMAZON_SECRET_KEY"
		}
	},

	"S3": {
		"connectTimeout": 5000,
		"socketTimeout": 5000,
		"maxAttempts": 50,
		"keyPrefix": "xyops/",
		"fileExtensions": true,
		"params": {
			"Bucket": "YOUR_S3_BUCKET_ID"
		},
		"cache": {
			"enabled": true,
			"maxItems": 100000,
			"maxBytes": 104857600
		}
	}
}
```

Use this when:

- You already operate Postgres.
- You already have object storage.
- You want multi-conductor support without introducing another data store.

Tradeoffs:

- You still have two backends to manage.
- AWS S3 is acceptable for files, but not for xyOps database traffic, which is why Postgres handles the document side.
- If your object storage is actually a fast on-prem S3 service, [MinIO](#minio) or [RustFS](#rustfs) are still simpler.

## Developer Configurations

> [!WARNING]
> The following configurations technically work, because pixl-server-storage allows JSON records and binary files to live in the same engine.  However, they are not recommended for serious production use with xyOps.  They are better suited for development, testing, and edge cases where you fully understand the tradeoffs.

### SQLite

Using plain [SQLite](https://github.com/jhuckaby/pixl-server-storage#sqlite) as the sole storage engine means **both** JSON records and binary files are stored inside the same database file.  This is convenient for development because everything lives in one place, but it is a poor production fit.

Why it is not recommended:

- Large files become `BLOB`s inside the table, so uploads and downloads must be materialized through SQLite and process memory.
- Big blobs inflate the WAL file, backups, restores, and vacuum operations.
- The database still lives on one host, so this does not solve multi-conductor storage sharing.
- A database that should contain lots of tiny JSON records now also has to carry general file storage, which is the wrong workload mix.

Use SQLite alone only for local development, small lab setups, or temporary testing.

### S3

Using a cloud-hosted [S3](https://github.com/jhuckaby/pixl-server-storage#amazon-s3) service as the only storage engine means every JSON record, list page, hash page, transaction record, and index-related object is stored as a separate S3 object.  pixl-server-storage supports this, but xyOps is a terrible workload for high-latency object storage on the document side.

For clarity, this is specifically talking about cloud-hosted S3 services like AWS S3, Cloudflare R2, Backblaze B2, Wasabi, DigitalOcean Spaces, Vultr, Akamai Object Storage, etc.

Why it is not recommended:

- xyOps performs an enormous number of reads and writes against tiny JSON objects.
- Even with the S3 cache enabled, cache misses and transactional workflows still pay remote object-store latency.
- Lists, hashes, indexes, and maintenance tasks amplify the small-object problem.
- S3 is designed for durable object storage, not as a low-latency database for millions of tiny records.

S3 is excellent as a `binaryEngine` (as part of a [Hybrid](https://github.com/jhuckaby/pixl-server-storage#hybrid) split).  It is *not* a great all-in-one engine for xyOps unless the S3 service is something like on-prem [MinIO](#minio) or [RustFS](#rustfs), where latency is much lower.

### Redis

Using plain [Redis](https://github.com/jhuckaby/pixl-server-storage#redis) or [RedisCluster](https://github.com/jhuckaby/pixl-server-storage#rediscluster) as the only storage engine means both JSON records and general file payloads live in Redis memory.  That is fast, but it is also very expensive and operationally awkward for binary storage.

Why it is not recommended:

- Files consume RAM during transit.
- Persistence operations such as RDB snapshots and AOF rewrites get larger and slower.
- Replication and restarts become more painful as binary payloads accumulate.
- If Redis eviction is enabled and memory pressure occurs, file loss becomes a real risk.

Redis is excellent as a document store for xyOps, provided persistence is enabled.  It is not a good place to keep general uploads, attachments, and file blobs.

### Postgres

Using plain [Postgres](https://github.com/jhuckaby/pixl-server-storage#postgres) as the only storage engine means both JSON records and general files are stored in the same table as `BYTEA` payloads.  This works, but it is not what Postgres does best.

Why it is not recommended:

- Large binary payloads bloat the table, WAL stream, backups, and replication traffic.
- File uploads and downloads still have to flow through the database connection pool and use memory.
- Autovacuum and general table maintenance become heavier than they need to be.
- It mixes two unrelated workloads, transactional document storage and general file storage, into one place.

Postgres is a very good `docEngine` (as part of a [Hybrid](https://github.com/jhuckaby/pixl-server-storage#hybrid) split).  It is not a great all-in-one engine for xyOps.

### NFS

Using plain [Filesystem](https://github.com/jhuckaby/pixl-server-storage#local-filesystem) pointed at NFS as the only storage engine sounds simple, but it means xyOps stores **everything** as files on a shared filesystem, including its document workload.  That is exactly the wrong shape for NFS at scale.

Why it is not recommended:

- xyOps generates a very large number of tiny JSON records, which means constant metadata churn and tiny-file I/O.
- Networked filesystems generally hate millions of tiny files spread across a hot working set.
- Cache coherency, locking behavior, and latency are all worse than local disk or a real key/value store.
- You may be able to improve consistency with mount options like `noac` and `sync`, but that usually makes performance even worse.

NFS is acceptable as a `binaryEngine` for files only (as part of a [Hybrid](https://github.com/jhuckaby/pixl-server-storage#hybrid) split).  It should not be your one-size-fits-all backend for xyOps production data.

## Migration

Migrating between storage configurations is straightforward, but do it during a maintenance window.  The safest approach is:

1. In the xyOps UI, go to **System** and click **Export Data**.
2. Export everything you need from the old system.  For a full logical migration, select all lists, all indexes, and all extras, including bucket files, ticket files, job files, user avatars, monitor data, and any other payloads you care about.
3. Shut down xyOps completely.
4. Change the [Storage](config.md#storage) configuration to the new engine or hybrid setup.
5. Start xyOps again.  If the new storage is empty, xyOps will create a fresh default dataset and you can log in with `admin` / `admin`.
6. Go back to **System** and import the export archive into the new storage backend.
7. Verify your users, schedules, alerts, buckets, tickets, and uploaded files before returning the system to service.

Important notes:

- The export/import flow is a **logical migration**, not a byte-for-byte replica of your old backend.
- If you want a truly complete migration, make sure you include the relevant extras for binary payloads.
- Very large job logs and job files may not be included in export if they exceed the built-in export limits.
- Always keep a backup of the old backend until you have validated the new one.

For more details on the export format, see [xyOps Backup Format](xybk.md).
