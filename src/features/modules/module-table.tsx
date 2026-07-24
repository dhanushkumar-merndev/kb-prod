"use client";

import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { format, isValid, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import type { ModuleColumn } from "./module-data";
import styles from "./workspace-module.module.css";

interface ModuleTableProps {
  columns: readonly ModuleColumn[];
  rows: readonly Record<string, unknown>[];
}

function formatDate(value: unknown, includeTime: boolean): string {
  if (typeof value !== "string" || value.length === 0) {
    return "—";
  }

  const date = parseISO(value);
  return isValid(date) ? format(date, includeTime ? "dd MMM yyyy, h:mm a" : "dd MMM yyyy") : value;
}

function formatCell(value: unknown, column: ModuleColumn): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  switch (column.format) {
    case "date":
      return formatDate(value, false);
    case "datetime":
      return formatDate(value, true);
    case "money": {
      const amount = typeof value === "number" ? value : Number(value);
      return Number.isFinite(amount)
        ? new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 2,
          }).format(amount)
        : String(value);
    }
    case "duration": {
      const seconds = typeof value === "number" ? value : Number(value);

      if (!Number.isFinite(seconds)) {
        return String(value);
      }

      const minutes = Math.floor(seconds / 60);
      return `${minutes}m ${Math.floor(seconds % 60)}s`;
    }
    default:
      if (typeof value === "boolean") {
        return value ? "Yes" : "No";
      }

      if (typeof value === "object") {
        return "Available";
      }

      return String(value).replaceAll("_", " ");
  }
}

export function ModuleTable({ columns, rows }: ModuleTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const tableColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      columns.map((column) => ({
        id: column.key,
        accessorFn: (row) => row[column.key],
        header: column.label,
        cell: ({ getValue }) => {
          const formatted = formatCell(getValue(), column);

          return column.format === "status" ? (
            <span className={styles.status}>{formatted}</span>
          ) : (
            formatted
          );
        },
        sortUndefined: "last",
      })),
    [columns],
  );
  const tableData = useMemo(() => [...rows], [rows]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    columns: tableColumns,
    data: tableData,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    initialState: {
      pagination: {
        pageSize: 10,
      },
    },
    state: { sorting },
  });

  const pageRows = table.getRowModel().rows;

  const rowVirtualizer = useVirtualizer({
    count: pageRows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 48,
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const paddingTop = virtualItems.length > 0 ? (virtualItems[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualItems.length > 0 ? totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0) : 0;

  return (
    <>
      <div
        className={styles.tableWrap}
        ref={tableContainerRef}
        style={{ maxHeight: "560px", overflowY: "auto" }}
      >
        <table className={styles.table}>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const direction = header.column.getIsSorted();

                  return (
                    <th
                      aria-sort={
                        direction === "asc"
                          ? "ascending"
                          : direction === "desc"
                            ? "descending"
                            : "none"
                      }
                      key={header.id}
                      scope="col"
                    >
                      {header.isPlaceholder ? null : (
                        <button
                          className={styles.sortButton}
                          onClick={header.column.getToggleSortingHandler()}
                          type="button"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <span aria-hidden="true">
                            {direction === "asc" ? " ↑" : direction === "desc" ? " ↓" : " ↕"}
                          </span>
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr>
                <td colSpan={columns.length} style={{ height: `${paddingTop}px` }} />
              </tr>
            )}
            {virtualItems.map((virtualRow) => {
              const row = pageRows[virtualRow.index];
              if (!row) {
                return null;
              }
              return (
                <tr key={typeof row.original.id === "string" ? row.original.id : row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr>
                <td colSpan={columns.length} style={{ height: `${paddingBottom}px` }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.mobileRecords}>
        {pageRows.map((row) => (
          <dl
            className={styles.mobileRecord}
            key={typeof row.original.id === "string" ? row.original.id : row.id}
          >
            {columns.map((column) => {
              const formatted = formatCell(row.original[column.key], column);

              return (
                <div className={styles.mobileField} key={column.key}>
                  <dt>{column.label}</dt>
                  <dd>
                    {column.format === "status" ? (
                      <span className={styles.status}>{formatted}</span>
                    ) : (
                      formatted
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        ))}
      </div>

      {table.getPageCount() > 1 && (
        <div
          style={{
            alignItems: "center",
            borderTop: "1px solid var(--hair-2)",
            display: "flex",
            flexWrap: "wrap",
            gap: "12px",
            justifyContent: "space-between",
            padding: "12px 18px",
          }}
        >
          <div style={{ color: "var(--slate)", fontFamily: "var(--font-mono)", fontSize: "12px" }}>
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()} (10 per page)
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.setPageIndex(0)}
              style={{
                background: "var(--card)",
                border: "1px solid var(--hair)",
                borderRadius: "var(--radius-sm)",
                cursor: table.getCanPreviousPage() ? "pointer" : "not-allowed",
                opacity: table.getCanPreviousPage() ? 1 : 0.4,
                padding: "6px 10px",
              }}
              type="button"
            >
              <ChevronsLeft size={16} />
            </button>
            <button
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
              style={{
                background: "var(--card)",
                border: "1px solid var(--hair)",
                borderRadius: "var(--radius-sm)",
                cursor: table.getCanPreviousPage() ? "pointer" : "not-allowed",
                opacity: table.getCanPreviousPage() ? 1 : 0.4,
                padding: "6px 10px",
              }}
              type="button"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
              style={{
                background: "var(--card)",
                border: "1px solid var(--hair)",
                borderRadius: "var(--radius-sm)",
                cursor: table.getCanNextPage() ? "pointer" : "not-allowed",
                opacity: table.getCanNextPage() ? 1 : 0.4,
                padding: "6px 10px",
              }}
              type="button"
            >
              <ChevronRight size={16} />
            </button>
            <button
              disabled={!table.getCanNextPage()}
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              style={{
                background: "var(--card)",
                border: "1px solid var(--hair)",
                borderRadius: "var(--radius-sm)",
                cursor: table.getCanNextPage() ? "pointer" : "not-allowed",
                opacity: table.getCanNextPage() ? 1 : 0.4,
                padding: "6px 10px",
              }}
              type="button"
            >
              <ChevronsRight size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
