import { useSensors, useSensor, TouchSensor, MouseSensor } from '@dnd-kit/core'

/** 长按启动拖拽的 sensor 配置（Android 标准交互） */
export function useDragSensors() {
  return useSensors(
    useSensor(TouchSensor, {
      activationConstraint: { delay: 300, tolerance: 5 },
    }),
    useSensor(MouseSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
  )
}
