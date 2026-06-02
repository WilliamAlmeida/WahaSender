const fs = require("node:fs");
const path = require("node:path");

const rootDir = __dirname;
const envFilePath = path.join(rootDir, ".env");
const logDir = path.join(rootDir, "storage", "logs");

if (!fs.existsSync(logDir)) {
	fs.mkdirSync(logDir, { recursive: true });
}

function loadEnvFile(filePath) {
	if (!fs.existsSync(filePath)) {
		return {};
	}

	const env = {};
	for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}

		const separatorIndex = trimmed.indexOf("=");
		if (separatorIndex === -1) {
			continue;
		}

		const key = trimmed.slice(0, separatorIndex).trim();
		const value = trimmed.slice(separatorIndex + 1);
		if (key) {
			env[key] = value;
		}
	}

	return env;
}

const fileEnv = loadEnvFile(envFilePath);
const sharedEnv = {
	...fileEnv,
	NODE_ENV: fileEnv.NODE_ENV || "production"
};

function createApp({ name, script, args, env = {} }) {
	return {
		name,
		cwd: rootDir,
		script,
		args,
		interpreter: "none", 
		exec_mode: "fork",
		instances: 1,
		watch: false,
		autorestart: true,
		merge_logs: true,
		out_file: path.join(logDir, `${name}.out.log`),
		error_file: path.join(logDir, `${name}.error.log`),
		log_date_format: "YYYY-MM-DD HH:mm:ss.SSS Z",
		env: {
			...sharedEnv,
			...env
		}
	};
}

module.exports = {
	apps: [
		createApp({
			name: "wahasender-web",
			script: "npm",
			args: ["start"],
			env: {
				SERVICE_NAME: "web"
			}
		}),
		createApp({
			name: "wahasender-worker",
			script: "npm",
			args: ["run", "start:worker"],
			env: {
				SERVICE_NAME: "worker"
			}
		})
	]
};