import { Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { AppointmentBookingDto, DoctorDto } from "src/appointment/dto/appointment-booking.dto";
import { TimeSlotDto } from "src/timeslot/dtos/timeslot.dto";
import { emitTyped } from "src/utils/helpers/event.helper";

@Injectable()
export class BookingAppointmentFieldSaga {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  private email: string;

//   @OnEvent('appointment.get-hospitals-specialties')
//   async handleGetFieldsData(email: string) {
//     this.email = email; // Store email for socket emission later
//     const specialties = await this.fetchSpecialties();
//     const hospitals = ["Hospital A", "Hospital B", "Hospital C"]; // Placeholder data
//     //const hospitals = await this.fetchHospitals(); // placeholder
//     this.eventEmitter.emit('appointment.hospitals-specialties.fetched', { hospitals, specialties, email });
//     console.log('[Saga] Emited event to push data to socket');
//   }

  @OnEvent('doctor.get-by-specialty')
  async handleGetDoctorsBySpecialty(payload: { specialtyId: string }) {
    const doctors = await this.fetchDoctors(payload.specialtyId);
    this.eventEmitter.emit('doctor.list.fetched', doctors);
  }

  @OnEvent('timeslot.get-by-doctor')
  async handleGetTimeSlots(payload: { doctorId: string; date: Date }) {
    const timeSlots = await this.fetchTimeSlots(payload.doctorId, payload.date);
    this.eventEmitter.emit('timeslot.list.fetched', timeSlots);
  }

  // -------------------------
  // Các hàm tách riêng cho fetch
  private async fetchSpecialties() {
    return await emitTyped<null, { id: string; name: string }[]>(
      this.eventEmitter,
      'specialty.get-all',
      null
    );
  }

  private async fetchDoctors(specialtyId: string) {
    return await emitTyped<{ specialtyId: string }, DoctorDto[]>(
      this.eventEmitter,
      'doctor.get-by-specialty',
      { specialtyId }
    );
  }

  private async fetchTimeSlots(doctorId: string, date: Date) {
    return await emitTyped<{ doctorId: string; date: Date }, TimeSlotDto[]>(
      this.eventEmitter,
      'timeslot.get-by-doctor',
      { doctorId, date }
    );
  }
}
