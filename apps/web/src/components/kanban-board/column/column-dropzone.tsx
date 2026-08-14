import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectWithTasks } from "@/types/project";
import TaskCard from "../task-card";

type ColumnDropzoneProps = {
  column: ProjectWithTasks["columns"][number];
  disableDragDrop?: boolean;
  onIsOverChange?: (isOver: boolean) => void;
};

export function ColumnDropzone({
  column,
  disableDragDrop = false,
  onIsOverChange,
}: ColumnDropzoneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: {
      type: "column",
      column,
    },
  });

  useEffect(() => {
    onIsOverChange?.(isOver);
  }, [isOver, onIsOverChange]);

  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();

  return (
    <div ref={setNodeRef} className="flex-1 min-h-0">
      <SortableContext
        items={column.tasks}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-2">
          {/* An empty column rendered nothing at all, so it read as a dead
              rectangle with no indication it could receive a card. Reuses an
              existing translated string rather than adding one. */}
          {column.tasks.length === 0 && (
            <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-border/60 px-3 py-6 text-[11px] text-muted-foreground">
              {t("tasks:listView.noTasks")}
            </div>
          )}
          <AnimatePresence initial={false} mode="popLayout">
            {column.tasks.map((task) => (
              <motion.div
                key={task.id}
                initial={
                  reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }
                }
                animate={
                  reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }
                }
                exit={
                  reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }
                }
                transition={{ type: "spring", duration: 0.35, bounce: 0.15 }}
              >
                <TaskCard task={task} disableDragDrop={disableDragDrop} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </SortableContext>
    </div>
  );
}
