const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  nombre: { 
    type: String, 
    required: true,
    trim: true
  },
  correo: { 
    type: String, 
    required: true, 
    unique: true, // Esto evita que dos personas se registren con el mismo email
    lowercase: true,
    trim: true
  },
  password: { 
    type: String, 
    required: true 
  },
  plan: {
    type: String,
    enum: ['free', 'pro_plus'],
    default: 'free'
  },
  fechaRegistro: { 
    type: Date, 
    default: Date.now 
  }
});

// Este es un "middleware" de Mongoose. 
// Justo antes de guardar el usuario en MongoDB, encripta la contraseña.
// Asegúrate de que use function(next) y no una flecha =>
userSchema.pre('save', async function(next) {
  const user = this;

  // Si la contraseña no ha cambiado, saltamos al siguiente paso
  if (!user.isModified('password')) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(user.password, salt);
    user.password = hash;
    
    // AQUÍ ES DONDE FALLABA: Asegúrate de llamar a next()
    next();
  } catch (error) {
    next(error);
  }
});

// Método para comparar la contraseña cuando el usuario intente hacer login
userSchema.methods.compararPassword = async function(passwordCandidata) {
  return await bcrypt.compare(passwordCandidata, this.password);
};

module.exports = mongoose.model('User', userSchema);