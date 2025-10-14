export interface TimeSlotDto {
    id: string;
    start: string; // e.g., "08:00"
    end: string;   // e.g., "09:00"
    label?: string; // e.g., "Ca sáng - Slot 1"
}