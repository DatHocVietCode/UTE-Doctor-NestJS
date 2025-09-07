
export interface CreateUserDto {
    email: string;
    password: string;
}

export interface updateUserDto {
    fullName?: string;
    email?: string;
    password?: string;
    role?: string;
}

export interface UserProfileDTO {
  id: string;
  name: string;
  email: string;
  dateOfBirth?: Date;
  phoneNumber?: string;
  avatarUrl?: string;
  bio?: string;
  location?: string;
  createdAt: Date;
  updatedAt: Date;
}