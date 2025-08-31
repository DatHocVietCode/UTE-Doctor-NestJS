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
    async sendOTP(@Body() body: { email: string }) {
        const { email } = body;
        return this.authService.handleOTPSending(email);
    }

    @Post("/verify-otp")
    async verifyOtp(@Body() body: { email: string, otp: string }) {
        const { email, otp } = body;
        return this.authService.verifyOTP(email, otp);
    }

}