
export class CreateUserDto {
    email: string;
    password: string;
}

export class updateUserDto {
    fullName?: string;
    email?: string;
    password?: string;
    role?: string;
}