// Structured response returned by admin staff-provisioning flows
// (DoctorService.createWithAccount / ReceptionistService.createWithAccount).
// Never include password or hash — only the data the FE needs to display the created user.
export interface StaffCreationResponse {
  account: {
    id: string;
    email: string;
    role: string;
    status: string;
  };
  profile: {
    id: string;
    fullName: string;
    phone?: string;
  };
  doctor?: {
    id: string;
    specialtyId?: string;
  };
  receptionist?: {
    id: string;
  };
  // Whether the credentials email was delivered. Records are committed regardless;
  // false means the admin should resend credentials / trigger a password reset.
  emailSent: boolean;
}
