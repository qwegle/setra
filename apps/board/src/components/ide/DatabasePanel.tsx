import { useState } from "react";
import { request } from "../../lib/api";
import { REPLIT } from "./types";

interface DatabaseConnection {
	id: string;
	name: string;
	type: "postgres" | "mysql" | "mssql" | "mongodb" | "sqlite";
	host: string;
	port: number;
	database: string;
	status: "connected" | "disconnected" | "error";
}

interface QueryResults {
	columns?: string[];
	rows?: Array<Record<string, unknown>>;
}

export function DatabasePanel({ projectId }: { projectId: string }) {
	const [connections, setConnections] = useState<DatabaseConnection[]>([]);
	const [queryText, setQueryText] = useState("");
	const [queryResults, setQueryResults] = useState<QueryResults | null>(null);
	const [showAddForm, setShowAddForm] = useState(false);
	const [newConn, setNewConn] = useState({
		name: "",
		type: "postgres" as const,
		host: "localhost",
		port: 5432,
		database: "",
		username: "",
		password: "",
	});

	const addConnection = async () => {
		try {
			const conn = await request<DatabaseConnection>(
				`/projects/${projectId}/database/connect`,
				{
					method: "POST",
					body: JSON.stringify(newConn),
				},
			);
			setConnections((prev) => [...prev, conn]);
			setShowAddForm(false);
		} catch (err) {
			console.error("Failed to connect:", err);
		}
	};

	const runQuery = async (connId: string) => {
		try {
			const data = await request<QueryResults>(
				`/projects/${projectId}/database/query`,
				{
					method: "POST",
					body: JSON.stringify({ connectionId: connId, query: queryText }),
				},
			);
			setQueryResults(data);
		} catch (err) {
			console.error("Query failed:", err);
		}
	};

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				background: REPLIT.background,
				color: REPLIT.text,
			}}
		>
			<div
				style={{
					padding: "12px 16px",
					borderBottom: `1px solid ${REPLIT.border}`,
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
				}}
			>
				<span style={{ fontWeight: 600, fontSize: 14 }}>Database</span>
				<button
					onClick={() => setShowAddForm(!showAddForm)}
					style={{
						background: REPLIT.accent,
						color: "#fff",
						border: "none",
						borderRadius: 6,
						padding: "4px 12px",
						cursor: "pointer",
						fontSize: 12,
					}}
				>
					+ Connect
				</button>
			</div>

			{showAddForm && (
				<div
					style={{ padding: 16, borderBottom: `1px solid ${REPLIT.border}` }}
				>
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "1fr 1fr",
							gap: 8,
							marginBottom: 8,
						}}
					>
						<input
							placeholder="Name"
							value={newConn.name}
							onChange={(e) =>
								setNewConn((p) => ({ ...p, name: e.target.value }))
							}
							style={{
								background: REPLIT.panelAlt,
								color: REPLIT.text,
								border: `1px solid ${REPLIT.border}`,
								borderRadius: 4,
								padding: "6px 8px",
								fontSize: 12,
							}}
						/>
						<select
							value={newConn.type}
							onChange={(e) =>
								setNewConn((p) => ({
									...p,
									type: e.target.value as typeof p.type,
								}))
							}
							style={{
								background: REPLIT.panelAlt,
								color: REPLIT.text,
								border: `1px solid ${REPLIT.border}`,
								borderRadius: 4,
								padding: "6px 8px",
								fontSize: 12,
							}}
						>
							<option value="postgres">PostgreSQL</option>
							<option value="mysql">MySQL</option>
							<option value="mssql">SQL Server</option>
							<option value="mongodb">MongoDB</option>
							<option value="sqlite">SQLite</option>
						</select>
						<input
							placeholder="Host"
							value={newConn.host}
							onChange={(e) =>
								setNewConn((p) => ({ ...p, host: e.target.value }))
							}
							style={{
								background: REPLIT.panelAlt,
								color: REPLIT.text,
								border: `1px solid ${REPLIT.border}`,
								borderRadius: 4,
								padding: "6px 8px",
								fontSize: 12,
							}}
						/>
						<input
							placeholder="Port"
							type="number"
							value={newConn.port}
							onChange={(e) =>
								setNewConn((p) => ({ ...p, port: Number(e.target.value) }))
							}
							style={{
								background: REPLIT.panelAlt,
								color: REPLIT.text,
								border: `1px solid ${REPLIT.border}`,
								borderRadius: 4,
								padding: "6px 8px",
								fontSize: 12,
							}}
						/>
						<input
							placeholder="Database"
							value={newConn.database}
							onChange={(e) =>
								setNewConn((p) => ({ ...p, database: e.target.value }))
							}
							style={{
								background: REPLIT.panelAlt,
								color: REPLIT.text,
								border: `1px solid ${REPLIT.border}`,
								borderRadius: 4,
								padding: "6px 8px",
								fontSize: 12,
							}}
						/>
						<input
							placeholder="Username"
							value={newConn.username}
							onChange={(e) =>
								setNewConn((p) => ({ ...p, username: e.target.value }))
							}
							style={{
								background: REPLIT.panelAlt,
								color: REPLIT.text,
								border: `1px solid ${REPLIT.border}`,
								borderRadius: 4,
								padding: "6px 8px",
								fontSize: 12,
							}}
						/>
						<input
							placeholder="Password"
							type="password"
							value={newConn.password}
							onChange={(e) =>
								setNewConn((p) => ({ ...p, password: e.target.value }))
							}
							style={{
								background: REPLIT.panelAlt,
								color: REPLIT.text,
								border: `1px solid ${REPLIT.border}`,
								borderRadius: 4,
								padding: "6px 8px",
								fontSize: 12,
							}}
						/>
					</div>
					<button
						onClick={addConnection}
						style={{
							background: REPLIT.accent,
							color: "#fff",
							border: "none",
							borderRadius: 6,
							padding: "6px 16px",
							cursor: "pointer",
							fontSize: 12,
							width: "100%",
						}}
					>
						Connect
					</button>
				</div>
			)}

			<div
				style={{
					padding: "8px 16px",
					borderBottom: `1px solid ${REPLIT.border}`,
				}}
			>
				{connections.length === 0 ? (
					<div
						style={{
							color: REPLIT.secondary,
							fontSize: 12,
							padding: "16px 0",
							textAlign: "center",
						}}
					>
						No database connections. Click + Connect to add one.
					</div>
				) : (
					connections.map((conn) => (
						<div
							key={conn.id}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 8,
								padding: "6px 0",
								fontSize: 12,
							}}
						>
							<span
								style={{
									width: 8,
									height: 8,
									borderRadius: "50%",
									background:
										conn.status === "connected"
											? REPLIT.success
											: conn.status === "error"
												? REPLIT.danger
												: REPLIT.secondary,
								}}
							/>
							<span style={{ fontWeight: 500 }}>{conn.name}</span>
							<span style={{ color: REPLIT.secondary }}>{conn.type}</span>
							<span style={{ color: REPLIT.secondary, marginLeft: "auto" }}>
								{conn.host}:{conn.port}
							</span>
						</div>
					))
				)}
			</div>

			<div
				style={{
					padding: 16,
					flex: 1,
					display: "flex",
					flexDirection: "column",
					gap: 8,
				}}
			>
				<textarea
					placeholder="SELECT * FROM users LIMIT 10;"
					value={queryText}
					onChange={(e) => setQueryText(e.target.value)}
					style={{
						background: REPLIT.panelAlt,
						color: REPLIT.text,
						border: `1px solid ${REPLIT.border}`,
						borderRadius: 4,
						padding: 8,
						fontSize: 12,
						fontFamily: "monospace",
						minHeight: 80,
						resize: "vertical",
					}}
				/>
				<button
					onClick={() => connections[0] && runQuery(connections[0].id)}
					disabled={!queryText.trim() || connections.length === 0}
					style={{
						background: connections.length > 0 ? REPLIT.accent : REPLIT.border,
						color: "#fff",
						border: "none",
						borderRadius: 6,
						padding: "6px 16px",
						cursor: connections.length > 0 ? "pointer" : "not-allowed",
						fontSize: 12,
						alignSelf: "flex-start",
					}}
				>
					▶ Run Query
				</button>

				{queryResults && Array.isArray(queryResults.rows) && (
					<div
						style={{
							overflow: "auto",
							flex: 1,
							border: `1px solid ${REPLIT.border}`,
							borderRadius: 4,
						}}
					>
						<table
							style={{
								width: "100%",
								borderCollapse: "collapse",
								fontSize: 11,
								fontFamily: "monospace",
							}}
						>
							<thead>
								<tr>
									{queryResults.columns?.map((col) => (
										<th
											key={col}
											style={{
												padding: "4px 8px",
												borderBottom: `1px solid ${REPLIT.border}`,
												textAlign: "left",
												background: REPLIT.panelAlt,
												color: REPLIT.accent,
												position: "sticky",
												top: 0,
											}}
										>
											{col}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{queryResults.rows.map((row, i) => (
									<tr key={`${i}-${JSON.stringify(row)}`}>
										{queryResults.columns?.map((col) => (
											<td
												key={col}
												style={{
													padding: "4px 8px",
													borderBottom: `1px solid ${REPLIT.border}`,
												}}
											>
												{String(row[col] ?? "")}
											</td>
										))}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	);
}
