import { Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginUserReqDto, RegisterUserDto } from "./dto/auth-user.dto";

@Controller("auth")
export class AuthController
{
    constructor(private readonly authService: AuthService) {}
    @Post("/register")
    async createNewUser(@Body() registerUserDTO: RegisterUserDto)
    {
        return this.authService.register(registerUserDTO);
    }
    @Post("/login")
    async loginUser(@Body() loginUserDTO: LoginUserReqDto)
    {
        return this.authService.login(loginUserDTO);
    }
    @Post("/send-otp")
    async sendOTP(@Body() email: string)
    {
        return this.authService.handleOTPSending(email);
    }
    @Post("/verify-otp")
    async verifyOtp(@Body() email:string, otp: string)
    {
        return this.authService.verifyOTP(email, otp);
    }
}